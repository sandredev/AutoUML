// src/render/canvas/spatial.ts — índice de rejilla uniforme (puro).
import type { LayoutResult } from '../types';
import type { Rect } from './viewport';

export interface SpatialIndex {
  cell: number;
  nodeBoxes: Float64Array; // x,y,w,h por nodo
  edgeBoxes: Float64Array; // caja envolvente por arista
  nodeCells: Map<number, number[]>;
  edgeCells: Map<number, number[]>;
  nodeMark: Uint32Array;
  edgeMark: Uint32Array;
  stamp: number;
}

const OFF = 1 << 20;
const SPAN = 2 ** 21;
const key = (cx: number, cy: number): number => (cx + OFF) * SPAN + (cy + OFF);

function insert(map: Map<number, number[]>, boxes: Float64Array, i: number, cell: number): void {
  const o = i * 4;
  const x0 = Math.floor((boxes[o] ?? 0) / cell);
  const y0 = Math.floor((boxes[o + 1] ?? 0) / cell);
  const x1 = Math.floor(((boxes[o] ?? 0) + (boxes[o + 2] ?? 0)) / cell);
  const y1 = Math.floor(((boxes[o + 1] ?? 0) + (boxes[o + 3] ?? 0)) / cell);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      const k = key(cx, cy);
      const list = map.get(k);
      if (list) list.push(i);
      else map.set(k, [i]);
    }
  }
}

export function buildIndex(layout: LayoutResult): SpatialIndex {
  const n = layout.nodes.length;
  const m = layout.edges.length;
  const area = Math.max(0, layout.bounds.w) * Math.max(0, layout.bounds.h);
  const cell = Math.max(64, Math.sqrt(area / Math.max(1, n)) * 1.5);
  const nodeBoxes = new Float64Array(n * 4);
  layout.nodes.forEach((b, i) => {
    nodeBoxes[i * 4] = b.x; nodeBoxes[i * 4 + 1] = b.y; nodeBoxes[i * 4 + 2] = b.w; nodeBoxes[i * 4 + 3] = b.h;
  });
  const edgeBoxes = new Float64Array(m * 4);
  layout.edges.forEach((e, i) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k + 1 < e.points.length; k += 2) {
      const x = e.points[k] ?? 0, y = e.points[k + 1] ?? 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
    edgeBoxes[i * 4] = x0; edgeBoxes[i * 4 + 1] = y0; edgeBoxes[i * 4 + 2] = x1 - x0; edgeBoxes[i * 4 + 3] = y1 - y0;
  });
  const nodeCells = new Map<number, number[]>();
  const edgeCells = new Map<number, number[]>();
  for (let i = 0; i < n; i++) insert(nodeCells, nodeBoxes, i, cell);
  for (let i = 0; i < m; i++) insert(edgeCells, edgeBoxes, i, cell);
  return { cell, nodeBoxes, edgeBoxes, nodeCells, edgeCells, nodeMark: new Uint32Array(n), edgeMark: new Uint32Array(m), stamp: 0 };
}

function nextStamp(ix: SpatialIndex): number {
  if (ix.stamp >= 0xfffffffe) {
    ix.stamp = 0;
    ix.nodeMark.fill(0);
    ix.edgeMark.fill(0);
  }
  return ++ix.stamp;
}

function query(ix: SpatialIndex, map: Map<number, number[]>, boxes: Float64Array, marks: Uint32Array, r: Rect): number[] {
  const out: number[] = [];
  const s = nextStamp(ix);
  const rx1 = r.x + r.w, ry1 = r.y + r.h;
  const visit = (list: number[]): void => {
    for (const i of list) {
      if (marks[i] === s) continue;
      marks[i] = s;
      const o = i * 4;
      const bx = boxes[o] ?? 0, by = boxes[o + 1] ?? 0;
      if (bx <= rx1 && bx + (boxes[o + 2] ?? 0) >= r.x && by <= ry1 && by + (boxes[o + 3] ?? 0) >= r.y) out.push(i);
    }
  };
  const x0 = Math.floor(r.x / ix.cell), x1 = Math.floor(rx1 / ix.cell);
  const y0 = Math.floor(r.y / ix.cell), y1 = Math.floor(ry1 / ix.cell);
  const cells = (x1 - x0 + 1) * (y1 - y0 + 1);
  if (!Number.isFinite(cells) || cells > map.size) {
    for (const list of map.values()) visit(list);
  } else {
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const list = map.get(key(cx, cy));
        if (list) visit(list);
      }
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

export function queryNodes(index: SpatialIndex, rect: Rect): number[] {
  return query(index, index.nodeCells, index.nodeBoxes, index.nodeMark, rect);
}

export function queryEdges(index: SpatialIndex, rect: Rect): number[] {
  return query(index, index.edgeCells, index.edgeBoxes, index.edgeMark, rect);
}

/** Nodo bajo el punto de mundo (x, y); el último dibujado gana. */
export function hitTestNode(index: SpatialIndex, layout: LayoutResult, x: number, y: number): string | null {
  const hits = queryNodes(index, { x, y, w: 0, h: 0 });
  const last = hits[hits.length - 1];
  return last === undefined ? null : (layout.nodes[last]?.id ?? null);
}
