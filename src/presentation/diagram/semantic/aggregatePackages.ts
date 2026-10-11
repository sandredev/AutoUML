// src/presentation/diagram/semantic/aggregatePackages.ts — zoom semántico (T10, puro).
// Lejos, cada paquete (el más externo) se dibuja como un bloque "nombre ×n" y las aristas entre paquetes
// se funden en una con grosor según n; las internas desaparecen (misma convención que layout/aggregate).
// Se calcula una vez por layout (memoizar fuera), nunca por zoom.
import type { LayoutResult } from '../types';

export interface PackageAggregate {
  name: string;
  classCount: number;
  bounds: { x: number; y: number; w: number; h: number };
}

export interface AggregatedEdge {
  source: string;
  target: string;
  /** Relaciones fusionadas. */
  n: number;
  /** Grosor en píxeles de pantalla. */
  width: number;
}

export interface SemanticAggregate {
  packages: PackageAggregate[];
  edges: AggregatedEdge[];
  /** Ids de nodos sin paquete: se siguen dibujando como cajas sueltas. */
  loose: string[];
  /** Nodo empaquetado → nombre de su bloque (paquete más externo). */
  owners: ReadonlyMap<string, string>;
}

/** Por debajo de SEMANTIC_LO solo bloques; por encima de SEMANTIC_HI solo tarjetas; en medio, fundido. */
export const SEMANTIC_LO = 0.1;
export const SEMANTIC_HI = 0.2;
const MAX_EDGE_WIDTH = 8;

/** Grosor creciente con n, acotado. */
export function edgeWidth(n: number): number {
  return Math.min(MAX_EDGE_WIDTH, 1 + 1.5 * Math.log2(Math.max(1, n)));
}

/** Opacidad de los bloques según el zoom (1 − la de las tarjetas): smoothstep entre LO y HI. */
export function blockAlpha(scale: number): number {
  const t = Math.max(0, Math.min(1, (scale - SEMANTIC_LO) / (SEMANTIC_HI - SEMANTIC_LO)));
  return 1 - t * t * (3 - 2 * t);
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function aggregatePackages(layout: LayoutResult): SemanticAggregate {
  const boxes = new Map(layout.packages.map((p) => [p.name, p]));
  const ownerCache = new Map<string, string | null>();
  /** Paquete más externo del layout que contiene a `pkg` (por prefijos con '.'). */
  const ownerOf = (pkg: string): string | null => {
    let hit = ownerCache.get(pkg);
    if (hit !== undefined) return hit;
    hit = null;
    for (let i = pkg.indexOf('.'); ; i = pkg.indexOf('.', i + 1)) {
      const prefix = i < 0 ? pkg : pkg.slice(0, i);
      if (boxes.has(prefix)) { hit = prefix; break; }
      if (i < 0) break;
    }
    ownerCache.set(pkg, hit);
    return hit;
  };

  const nodeOwner = new Map<string, string>();
  const counts = new Map<string, number>();
  const loose: string[] = [];
  for (const n of layout.nodes) {
    const owner = n.packageName ? ownerOf(n.packageName) : null;
    if (owner === null) { loose.push(n.id); continue; }
    nodeOwner.set(n.id, owner);
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }

  const edgeCounts = new Map<string, { source: string; target: string; n: number }>();
  for (const e of layout.edges) {
    const s = nodeOwner.get(e.source);
    const t = nodeOwner.get(e.target);
    if (s === undefined || t === undefined || s === t) continue;
    const key = s + '\n' + t;
    const acc = edgeCounts.get(key);
    if (acc) acc.n++;
    else edgeCounts.set(key, { source: s, target: t, n: 1 });
  }

  const packages = [...counts.keys()].sort(byName).map((name) => {
    const b = boxes.get(name)!;
    return { name, classCount: counts.get(name)!, bounds: { x: b.x, y: b.y, w: b.w, h: b.h } };
  });
  const edges = [...edgeCounts.values()]
    .sort((a, b) => byName(a.source, b.source) || byName(a.target, b.target))
    .map((e) => ({ ...e, width: edgeWidth(e.n) }));
  return { packages, edges, loose, owners: nodeOwner };
}

const memo = new WeakMap<LayoutResult, SemanticAggregate>();
/** aggregatePackages memoizado por layout: se recalcula solo cuando cambia el layout, nunca por zoom. */
export function semanticOf(layout: LayoutResult): SemanticAggregate {
  let hit = memo.get(layout);
  if (!hit) {
    hit = aggregatePackages(layout);
    memo.set(layout, hit);
  }
  return hit;
}
