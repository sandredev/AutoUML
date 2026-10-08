import { describe, expect, it } from 'vitest';
import type { EdgePath, LayoutResult, NodeBox, PackageBox } from '../types';
import { easeOutCubic, finalizeDrop, fitPackages, interpolateLayout, moveNodePreview, packageAt, resolveOverlaps, routeEdge } from './dragNode';

function node(id: string, x: number, y: number, pkg: string): NodeBox {
  return { id, x, y, w: 100, h: 60, packageName: pkg };
}

function overlap(a: NodeBox, b: NodeBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function sample(): LayoutResult {
  const nodes = [node('a', 0, 0, 'p1'), node('b', 140, 0, 'p1'), node('c', 0, 300, 'p2'), node('d', 140, 300, 'p2')];
  const edges: EdgePath[] = [{ source: 'a', target: 'c', type: 'ASSOCIATION', points: [50, 60, 50, 300] }];
  const pk: PackageBox[] = [{ name: 'p1', x: 0, y: 0, w: 1, h: 1, tabW: 40 }, { name: 'p2', x: 0, y: 0, w: 1, h: 1, tabW: 40 }];
  const packages = fitPackages(nodes, pk);
  return { nodes, edges, packages, bounds: { x: 0, y: 0, w: 300, h: 400 } };
}

describe('dragNode', () => {
  it('routeEdge termina en el borde del destino', () => {
    const pts = routeEdge(node('s', 0, 0, 'p'), node('t', 0, 200, 'p'));
    expect(pts[pts.length - 1]).toBeCloseTo(200);
    expect(pts[1]).toBeCloseTo(60);
  });

  it('moveNodePreview reenruta solo las aristas del nodo', () => {
    const l = moveNodePreview(sample(), 'a', 400, 0);
    expect(l.nodes.find((n) => n.id === 'a')?.x).toBe(400);
    expect(l.edges[0]?.points[0]).not.toBe(50);
  });

  it('packageAt elige el paquete más interno', () => {
    const pk: PackageBox[] = [{ name: 'out', x: 0, y: 0, w: 500, h: 500 }, { name: 'in', x: 10, y: 10, w: 50, h: 50 }];
    expect(packageAt(pk, 20, 20)).toBe('in');
    expect(packageAt(pk, 200, 200)).toBe('out');
    expect(packageAt(pk, 900, 900)).toBeNull();
  });

  it('resolveOverlaps deja sin solapes y no mueve el nodo soltado', () => {
    const nodes = [node('m', 0, 0, 'p'), node('x', 10, 10, 'p'), node('y', 30, 20, 'p'), node('z', 60, 5, 'p')];
    const out = resolveOverlaps(nodes, 'm', () => true);
    expect(out[0]?.x).toBe(0);
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        if (a && b) expect(overlap(a, b)).toBe(false);
      }
    }
  });

  it('finalizeDrop reasigna paquete y los paquetes no se solapan', () => {
    const l = finalizeDrop(sample(), 'a', 20, 320, 'p2');
    expect(l.nodes.find((n) => n.id === 'a')?.packageName).toBe('p2');
    const p1 = l.packages.find((p) => p.name === 'p1');
    const p2 = l.packages.find((p) => p.name === 'p2');
    expect(p1 && p2).toBeTruthy();
    if (p1 && p2) {
      const sep = p1.x + p1.w <= p2.x || p2.x + p2.w <= p1.x || p1.y + p1.h <= p2.y || p2.y + p2.h <= p1.y;
      expect(sep).toBe(true);
    }
    const p2Nodes = l.nodes.filter((n) => n.packageName === 'p2');
    for (let i = 0; i < p2Nodes.length; i++) {
      for (let j = i + 1; j < p2Nodes.length; j++) {
        const a = p2Nodes[i];
        const b = p2Nodes[j];
        if (a && b) expect(overlap(a, b)).toBe(false);
      }
    }
  });

  it('interpolateLayout va de origen a destino', () => {
    const from = sample();
    const to = moveNodePreview(from, 'a', 200, 100);
    const mid = interpolateLayout(from, to, 0.5);
    expect(mid.nodes.find((n) => n.id === 'a')?.x).toBeCloseTo(100);
    expect(interpolateLayout(from, to, 1)).toBe(to);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('rendimiento: soltar en un diagrama de 1000 nodos / 2000 aristas', () => {
    const nodes: NodeBox[] = [];
    for (let i = 0; i < 1000; i++) nodes.push(node('n' + String(i), (i % 40) * 140, Math.floor(i / 40) * 100, 'p' + String(i % 20)));
    const edges: EdgePath[] = [];
    for (let i = 0; i < 2000; i++) edges.push({ source: 'n' + String(i % 1000), target: 'n' + String((i * 7) % 1000), type: 'DEPENDENCY', points: [0, 0, 1, 1] });
    const pk: PackageBox[] = [];
    for (let i = 0; i < 20; i++) pk.push({ name: 'p' + String(i), x: 0, y: 0, w: 1, h: 1 });
    const layout: LayoutResult = { nodes, edges, packages: pk, bounds: { x: 0, y: 0, w: 1, h: 1 } };
    const t0 = performance.now();
    const out = finalizeDrop(layout, 'n5', 300, 300, 'p3');
    const ms = performance.now() - t0;
    expect(out.nodes.length).toBe(1000);
    expect(ms).toBeLessThan(500);
  });
});
