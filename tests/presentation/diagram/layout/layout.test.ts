import { describe, expect, it } from 'vitest';
import type { Category, DeclaredKind, DiagramModel, RelationshipModel, RelType, TypeNode } from '../../../../src/domain/diagram/model';
import type { NodeBox } from '../../../../src/presentation/diagram/types';
import { computeLayout } from '../../../../src/presentation/diagram/layout/layout';

function type(id: string, pkg = 'x.dom', kind: DeclaredKind = 'class', members = 2): TypeNode {
  return {
    id, name: id, packageName: pkg, declaredKind: kind, category: kind as Category,
    isAbstract: kind === 'abstract', isSealed: false, isExternal: false, implicit: false, stereotypes: [],
    attributes: Array.from({ length: members }, (_, i) => ({ name: `a${i}`, type: 'int', visibility: '-' as const, isStatic: false })),
    methods: [], constructors: [], enumConstants: [], line: 1,
  };
}
function rel(source: string, target: string, t: RelType = 'ASSOCIATION'): RelationshipModel {
  return { source, target, type: t, line: 1 };
}
function model(types: TypeNode[], rels: RelationshipModel[], summary = false): DiagramModel {
  const pk = new Map<string, string[]>();
  for (const t of types) pk.set(t.packageName, [...(pk.get(t.packageName) ?? []), t.id]);
  return {
    types, relationships: rels, summaryMode: summary, issues: [],
    packages: [...pk].map(([name, typeIds]) => ({ name, typeIds })),
  };
}
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function sample(): DiagramModel {
  const r = rng(7);
  const types = Array.from({ length: 40 }, (_, i) => type(`T${i}`, i < 20 ? 'p.a' : 'p.b', 'class', Math.floor(r() * 6)));
  const rels: RelationshipModel[] = [];
  for (let i = 1; i < 40; i++) rels.push(rel(`T${i}`, `T${Math.floor(r() * i)}`, i % 3 === 0 ? 'EXTENDS' : 'ASSOCIATION'));
  rels.push(rel('T5', 'NoExiste'), rel('T3', 'T3', 'DEPENDENCY'));
  return model(types, rels);
}
const touches = (b: NodeBox, x: number, y: number, eps = 0.5): boolean =>
  x >= b.x - eps && x <= b.x + b.w + eps && y >= b.y - eps && y <= b.y + b.h + eps &&
  (Math.abs(x - b.x) < eps || Math.abs(x - b.x - b.w) < eps || Math.abs(y - b.y) < eps || Math.abs(y - b.y - b.h) < eps);

// ¿El segmento atraviesa el interior de la caja? (rozar el borde no cuenta).
function crosses(ax: number, ay: number, bx: number, by: number, b: { x: number; y: number; w: number; h: number }): boolean {
  const x0 = b.x + 1;
  const y0 = b.y + 1;
  const x1 = b.x + b.w - 1;
  const y1 = b.y + b.h - 1;
  if (x0 >= x1 || y0 >= y1) return false;
  if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1) return false;
  if (Math.max(ay, by) < y0 || Math.min(ay, by) > y1) return false;
  if (ax > x0 && ax < x1 && ay > y0 && ay < y1) return true;
  if (bx > x0 && bx < x1 && by > y0 && by < y1) return true;
  const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number => {
    const v = (qx - px) * (ry - py) - (qy - py) * (rx - px);
    return v > 0 ? 1 : v < 0 ? -1 : 0;
  };
  const xseg = (cx: number, cy: number, dx: number, dy: number, ex: number, ey: number, fx: number, fy: number): boolean => {
    if (Math.max(cx, dx) < Math.min(ex, fx) || Math.max(ex, fx) < Math.min(cx, dx)) return false;
    if (Math.max(cy, dy) < Math.min(ey, fy) || Math.max(ey, fy) < Math.min(cy, dy)) return false;
    return orient(cx, cy, dx, dy, ex, ey) !== orient(cx, cy, dx, dy, fx, fy)
      && orient(ex, ey, fx, fy, cx, cy) !== orient(ex, ey, fx, fy, dx, dy);
  };
  return xseg(ax, ay, bx, by, x0, y0, x1, y0)
    || xseg(ax, ay, bx, by, x1, y0, x1, y1)
    || xseg(ax, ay, bx, by, x1, y1, x0, y1)
    || xseg(ax, ay, bx, by, x0, y1, x0, y0);
}

function edgeCrossesBox(pts: number[], b: { x: number; y: number; w: number; h: number }): boolean {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    if (crosses(pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!, b)) return true;
  }
  return false;
}

describe('computeLayout', () => {
  it('el padre queda por encima del hijo', () => {
    const L = computeLayout(model([type('Hijo'), type('Padre', 'x.dom', 'abstract'), type('I', 'x.dom', 'interface')],
      [rel('Hijo', 'Padre', 'EXTENDS'), rel('Hijo', 'I', 'IMPLEMENTS')]));
    const by = (id: string) => L.nodes.find((n) => n.id === id)!;
    expect(by('Padre').y + by('Padre').h).toBeLessThanOrEqual(by('Hijo').y);
    expect(by('I').y + by('I').h).toBeLessThanOrEqual(by('Hijo').y);
  });

  it("en LR el padre queda a la izquierda del hijo", () => {
    const m = model([type('Hijo'), type('Padre', 'x.dom', 'abstract')],
      [rel('Hijo', 'Padre', 'EXTENDS')]);
    m.direction = 'LR';
    const L = computeLayout(m);
    const by = (id: string) => L.nodes.find((n) => n.id === id)!;
    expect(by('Padre').x + by('Padre').w).toBeLessThanOrEqual(by('Hijo').x);
  });

  it('sin solapes, puntos finitos y el último toca al destino', () => {
    const L = computeLayout(sample());
    for (let i = 0; i < L.nodes.length; i++) {
      for (let j = i + 1; j < L.nodes.length; j++) {
        const a = L.nodes[i]!, b = L.nodes[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.id} vs ${b.id}`).toBe(false);
      }
    }
    expect(L.edges.some((e) => e.target === 'NoExiste')).toBe(false);
    for (const e of L.edges) {
      expect(e.points.length).toBeGreaterThanOrEqual(4);
      expect(e.points.every(Number.isFinite)).toBe(true);
      const t = L.nodes.find((n) => n.id === e.target)!;
      expect(touches(t, e.points[e.points.length - 2]!, e.points[e.points.length - 1]!)).toBe(true);
    }
  });

  it('los nodos de cada paquete quedan dentro de su caja', () => {
    const m = sample();
    const L = computeLayout(m);
    for (const p of L.packages) {
      for (const id of m.packages.find((q) => q.name === p.name)!.typeIds) {
        const n = L.nodes.find((x) => x.id === id)!;
        expect(n.x).toBeGreaterThanOrEqual(p.x);
        expect(n.y).toBeGreaterThanOrEqual(p.y);
        expect(n.x + n.w).toBeLessThanOrEqual(p.x + p.w);
        expect(n.y + n.h).toBeLessThanOrEqual(p.y + p.h);
      }
    }
  });

  it('las aristas entre paquetes no atraviesan terceros paquetes', () => {
    const m = model(
      [type('A1', 'p.a'), type('A2', 'p.a'), type('B1', 'p.b'), type('B2', 'p.b'), type('C1', 'p.c'), type('C2', 'p.c')],
      [rel('A1', 'C1'), rel('A2', 'B1'), rel('B2', 'C2'), rel('A1', 'B2', 'EXTENDS')],
    );
    const L = computeLayout(m);
    const pkgOf = new Map(L.nodes.map((n) => [n.id, n.packageName ?? '']));
    const boxOf = new Map(L.packages.map((p) => [p.name, p]));
    for (const e of L.edges) {
      const pa = pkgOf.get(e.source) ?? '';
      const pb = pkgOf.get(e.target) ?? '';
      if (pa === pb) continue;
      for (const p of L.packages) {
        if (p.name === pa || p.name === pb) continue;
        expect(edgeCrossesBox(e.points, p), `${e.source}->${e.target} cruza ${p.name}`).toBe(false);
      }
      // Toca los bordes de sus dos paquetes (sale por uno y entra por el otro).
      const boxA = boxOf.get(pa)!;
      const boxB = boxOf.get(pb)!;
      const nearBorder = (b: { x: number; y: number; w: number; h: number }): boolean =>
        e.points.some((_, i) => i % 2 === 0 && touches({ ...b, id: '' } as NodeBox, e.points[i]!, e.points[i + 1]!, 2));
      expect(nearBorder(boxA), `${e.source}->${e.target} no toca ${pa}`).toBe(true);
      expect(nearBorder(boxB), `${e.source}->${e.target} no toca ${pb}`).toBe(true);
    }
  });

  it('las aristas paralelas del mismo par se separan en carriles', () => {
    const m = model(
      [type('A1', 'p.a'), type('A2', 'p.a'), type('C1', 'p.c'), type('C2', 'p.c')],
      [rel('A1', 'C1'), rel('A2', 'C2')],
    );
    const L = computeLayout(m);
    const [e1, e2] = L.edges;
    expect(L.edges).toHaveLength(2);
    expect(JSON.stringify(e1!.points)).not.toBe(JSON.stringify(e2!.points));
  });

  it('grafo vacío', () => {
    const L = computeLayout(model([], []));
    expect(L.bounds.w).toBe(0);
    expect(L.bounds.h).toBe(0);
    expect(L.nodes).toEqual([]);
  });

  it('determinista', () => {
    expect(JSON.stringify(computeLayout(sample()))).toBe(JSON.stringify(computeLayout(sample())));
  });

  it('1000 nodos y 2000 aristas en < 3 s', () => {
    const types = Array.from({ length: 1000 }, (_, i) => type(`T${i}`, `p${Math.floor(i / 50)}`, 'class', 1));
    const rels = Array.from({ length: 2000 }, (_, k) => rel(`T${k % 1000}`, `T${(k * 7 + 1) % 1000}`, k % 2 ? 'DEPENDENCY' : 'ASSOCIATION'));
    const t0 = performance.now();
    const L = computeLayout(model(types, rels, true));
    const dt = performance.now() - t0;
    expect(L.nodes).toHaveLength(1000);
    expect(L.edges.length).toBeGreaterThan(1900);
    expect(dt).toBeLessThan(3000);
  }, 20000);
});
