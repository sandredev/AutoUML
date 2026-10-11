import { describe, expect, it } from 'vitest';
import type { DiagramModel } from '../../../../src/domain/diagram/model';
import { computeElkLayout } from '../../../../src/presentation/diagram/layout/elkLayout';
import { computeLayout } from '../../../../src/presentation/diagram/layout/layout';
import {
  anchorToHints, completeHints, hintsOf, hintsUsable, translateLayout, warpFlowToHints,
  type LayoutHints,
} from '../../../../src/presentation/diagram/layout/stability';
import type { LayoutResult, NodeBox } from '../../../../src/presentation/diagram/types';
import { diagram, rel, typeNode } from '../../../helpers/diagramBuilders';

const box = (id: string, x: number, y: number, w = 100, h = 40, extra: Partial<NodeBox> = {}): NodeBox => ({ id, x, y, w, h, ...extra });
const layoutOf = (nodes: NodeBox[], packages: LayoutResult['packages'] = []): LayoutResult => ({
  nodes, edges: [], packages, bounds: { x: 0, y: 0, w: 1000, h: 1000 },
});

describe('hintsOf / hintsUsable', () => {
  it('guarda tarjetas y paquetes (estos con prefijo pkg::)', () => {
    const h = hintsOf(layoutOf([box('A', 10, 20)], [{ name: 'p', x: 1, y: 2, w: 3, h: 4 }]));
    expect(h['A']).toEqual({ x: 10, y: 20 });
    expect(h['pkg::p']).toEqual({ x: 1, y: 2 });
  });

  it('solo se usan si sobrevive al menos la mitad y hay 3 o más', () => {
    const h: LayoutHints = { A: { x: 0, y: 0 }, B: { x: 0, y: 0 }, C: { x: 0, y: 0 } };
    expect(hintsUsable(['A', 'B', 'C'], h)).toBe(true);
    expect(hintsUsable(['A', 'B', 'C', 'D', 'E', 'F', 'G'], h)).toBe(false); // 3/7 < 50 %
    expect(hintsUsable(['A', 'B'], { A: { x: 0, y: 0 }, B: { x: 0, y: 0 } })).toBe(false); // < 3
    expect(hintsUsable(['A', 'B', 'C'], undefined)).toBe(false);
  });
});

describe('completeHints', () => {
  const size = (): { w: number; h: number } => ({ w: 100, h: 40 });
  const base: LayoutHints = {
    P: { x: 200, y: 0 }, A: { x: 100, y: 100 }, B: { x: 300, y: 100 }, C: { x: 100, y: 200 },
  };

  it('una hoja nueva va en la capa siguiente a su padre, no a una distancia fija', () => {
    const out = completeHints({
      ids: ['P', 'A', 'B', 'C', 'N'], hints: base, size, dir: 'TB', rankSep: 80, nodeSep: 40,
      edges: [{ from: 'P', to: 'A' }, { from: 'P', to: 'B' }, { from: 'A', to: 'C' }, { from: 'B', to: 'N' }],
    });
    expect(out['N']?.y).toBe(200); // la capa de C, justo debajo de la de B (y=100)
    expect(out['A']).toEqual(base['A']); // los que ya estaban no se tocan
  });

  it('busca un hueco libre en la fila en vez de caer encima de una vecina', () => {
    const out = completeHints({
      ids: ['P', 'A', 'B', 'C', 'N'], hints: base, size, dir: 'TB', rankSep: 80, nodeSep: 40,
      edges: [{ from: 'A', to: 'N' }], // N querría x = 100, que ocupa C
    });
    const n = out['N'] as { x: number; y: number };
    const c = base['C'] as { x: number; y: number };
    expect(n.y).toBe(200);
    expect(n.x + 100 + 40 <= c.x || n.x >= c.x + 100 + 40).toBe(true);
  });

  it('una tarjeta sin vecinas va al final de la primera capa', () => {
    const out = completeHints({ ids: ['P', 'A', 'B', 'C', 'Z'], hints: base, size, dir: 'TB', rankSep: 80, nodeSep: 40, edges: [] });
    expect(out['Z']?.y).toBe(0);
    expect(out['Z']?.x).toBeGreaterThanOrEqual(400);
  });

  it('en LR el flujo es el eje X', () => {
    const lr: LayoutHints = { P: { x: 0, y: 100 }, A: { x: 200, y: 100 }, B: { x: 200, y: 200 } };
    const out = completeHints({ ids: ['P', 'A', 'B', 'N'], hints: lr, size, dir: 'LR', rankSep: 80, nodeSep: 40, edges: [{ from: 'P', to: 'N' }] });
    expect(out['N']?.x).toBe(200); // misma capa que A y B
  });

  it('con paquetes, la tarjeta nueva se queda en el rango transversal de su paquete', () => {
    const hints: LayoutHints = { A: { x: 0, y: 0 }, B: { x: 150, y: 0 }, X: { x: 800, y: 0 }, Y: { x: 800, y: 100 } };
    const out = completeHints({
      ids: ['A', 'B', 'X', 'Y', 'N'], hints, size, dir: 'TB', rankSep: 80, nodeSep: 10,
      edges: [{ from: 'X', to: 'N' }], // vecina en el otro extremo
      groupOf: (id) => (id === 'X' || id === 'Y' ? 'q' : 'p'), // N es de p
    });
    expect(out['N']?.x).toBeLessThan(400);
  });
});

describe('anclaje al layout anterior', () => {
  it('quita la traslación global (ELK añade márgenes)', () => {
    const prev = layoutOf([box('A', 0, 0), box('B', 200, 100), box('C', 400, 100)]);
    const next = layoutOf([box('A', 12, 12), box('B', 212, 112), box('C', 412, 112)]);
    const out = anchorToHints(next, hintsOf(prev));
    expect(out.nodes.map((n) => [n.x, n.y])).toEqual([[0, 0], [200, 100], [400, 100]]);
  });

  it('la mediana ignora a los que sí se movieron de verdad', () => {
    const prev = layoutOf([box('A', 0, 0), box('B', 200, 0), box('C', 400, 0), box('D', 600, 0)]);
    const next = layoutOf([box('A', 10, 0), box('B', 210, 0), box('C', 410, 0), box('D', 900, 0)]);
    const out = anchorToHints(next, hintsOf(prev));
    expect(out.nodes.map((n) => n.x)).toEqual([0, 200, 400, 890]);
  });

  it('sin supervivientes no toca nada', () => {
    const next = layoutOf([box('X', 5, 5)]);
    expect(anchorToHints(next, hintsOf(layoutOf([box('Y', 0, 0)])))).toBe(next);
  });

  it('devuelve cada capa a su Y anterior, con tarjetas rígidas y aristas deformadas igual', () => {
    const prev = layoutOf([box('A', 0, 0), box('B', 0, 60), box('C', 0, 120)]); // capas muy juntas
    const next: LayoutResult = {
      nodes: [box('A', 0, 0), box('B', 0, 120), box('C', 0, 240)], // ELK las separó más
      edges: [{ source: 'A', target: 'B', type: 'ASSOCIATION', points: [50, 40, 50, 80, 50, 120] }],
      packages: [], bounds: { x: 0, y: 0, w: 100, h: 280 },
    };
    const out = warpFlowToHints(next, hintsOf(prev), 'TB');
    expect(out.nodes.map((n) => n.y)).toEqual([0, 60, 120]);
    expect(out.nodes.every((n) => n.h === 40)).toBe(true);
    const pts = out.edges[0]?.points ?? [];
    expect(pts[1]).toBe(40); // sale del borde inferior de A
    expect(pts[pts.length - 1]).toBe(60); // llega al borde superior de B (nueva y)
  });

  it('no deja que dos capas se solapen al devolverlas', () => {
    const prev = layoutOf([box('A', 0, 0), box('B', 0, 45)]);
    const next = layoutOf([box('A', 0, 0, 100, 80), box('B', 0, 200)]); // A creció a 80 de alto
    const out = warpFlowToHints(next, hintsOf(prev), 'TB');
    const a = out.nodes[0] as NodeBox;
    const b = out.nodes[1] as NodeBox;
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.h);
  });

  it('translateLayout traslada tarjetas, aristas, paquetes, notas y límites', () => {
    const l: LayoutResult = {
      nodes: [box('A', 0, 0)], packages: [{ name: 'p', x: 0, y: 0, w: 10, h: 10 }],
      edges: [{ source: 'A', target: 'A', type: 'ASSOCIATION', points: [1, 2, 3, 4] }],
      notes: [{ id: 'n', x: 5, y: 5, w: 1, h: 1, lines: [] }], bounds: { x: 0, y: 0, w: 10, h: 10 },
    };
    const t = translateLayout(l, 10, 20);
    expect(t.nodes[0]).toMatchObject({ x: 10, y: 20 });
    expect(t.packages[0]).toMatchObject({ x: 10, y: 20 });
    expect(t.edges[0]?.points).toEqual([11, 22, 13, 24]);
    expect(t.notes?.[0]).toMatchObject({ x: 15, y: 25 });
    expect(t.bounds).toMatchObject({ x: 10, y: 20 });
  });
});

// ---------- Integración con ELK real: el criterio de aceptación de T6 ----------
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Árbol de herencia de `n` clases con algunas asociaciones; con `pkgs` > 0 las reparte en paquetes. */
function build(seed: number, opts: { n?: number; pkgs?: number; dir?: 'LR'; leafOf?: string; drop?: string } = {}): DiagramModel {
  const n = opts.n ?? 30;
  const r = rng(seed);
  const pkgOf = (i: number): Partial<ReturnType<typeof typeNode>> => (opts.pkgs ? { packageName: 'p' + (i % opts.pkgs) } : {});
  let types = Array.from({ length: n }, (_, i) => typeNode('C' + i, pkgOf(i)));
  let rels = [];
  for (let i = 1; i < n; i++) rels.push(rel('C' + i, 'C' + Math.floor(r() * i), { type: 'EXTENDS' }));
  for (let k = 0; k < 8; k++) {
    const a = Math.floor(r() * n), b = Math.floor(r() * n);
    if (a !== b) rels.push(rel('C' + a, 'C' + b));
  }
  if (opts.leafOf) {
    const parent = types.find((t) => t.id === opts.leafOf);
    types = [...types, typeNode('NEW', { packageName: parent?.packageName ?? '(default package)' })];
    rels = [...rels, rel('NEW', opts.leafOf, { type: 'EXTENDS' })];
  }
  if (opts.drop) {
    types = types.filter((t) => t.id !== opts.drop);
    rels = rels.filter((e) => e.source !== opts.drop && e.target !== opts.drop);
  }
  const m = diagram(types, rels);
  if (opts.dir) m.direction = opts.dir;
  return m;
}

/** Fracción de tarjetas comunes que se movieron más de `px`. */
function movedFraction(a: LayoutResult, b: LayoutResult, px = 50): number {
  const next = new Map(b.nodes.map((n) => [n.id, n]));
  const common = a.nodes.filter((n) => next.has(n.id));
  const moved = common.filter((n) => Math.hypot((next.get(n.id) as NodeBox).x - n.x, (next.get(n.id) as NodeBox).y - n.y) > px);
  return moved.length / common.length;
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

describe('layout estable con ELK (T6)', () => {
  it('añadir una clase hoja a un diagrama de 30 mueve < 20 % de las tarjetas más de 50 px', async () => {
    for (const seed of SEEDS) {
      const before = await computeElkLayout(build(seed));
      const after = await computeElkLayout(build(seed, { leafOf: 'C' + (3 + (seed % 20)) }), { hints: hintsOf(before) });
      expect(movedFraction(before, after), `semilla ${seed}`).toBeLessThan(0.2);
    }
  }, 60_000);

  it('sin pistas el mismo cambio reorganiza casi todo (el test anterior no es trivial)', async () => {
    let total = 0;
    for (const seed of SEEDS) {
      const before = await computeElkLayout(build(seed));
      const after = await computeElkLayout(build(seed, { leafOf: 'C' + (3 + (seed % 20)) }));
      total += movedFraction(before, after);
    }
    expect(total / SEEDS.length).toBeGreaterThan(0.5);
  }, 60_000);

  it('también con paquetes (el primer layout es jerárquico, el siguiente plano)', async () => {
    for (const seed of SEEDS) {
      const before = await computeElkLayout(build(seed, { pkgs: 4 }));
      const after = await computeElkLayout(build(seed, { pkgs: 4, leafOf: 'C' + (3 + (seed % 20)) }), { hints: hintsOf(before) });
      expect(movedFraction(before, after), `semilla ${seed}`).toBeLessThan(0.3);
      // Cada caja de paquete contiene a todos sus miembros.
      for (const p of after.packages) {
        for (const n of after.nodes.filter((q) => q.packageName === p.name)) {
          expect(n.x).toBeGreaterThanOrEqual(p.x);
          expect(n.y).toBeGreaterThanOrEqual(p.y);
          expect(n.x + n.w).toBeLessThanOrEqual(p.x + p.w);
          expect(n.y + n.h).toBeLessThanOrEqual(p.y + p.h);
        }
      }
    }
  }, 60_000);

  it('en LR también', async () => {
    for (const seed of SEEDS) {
      const before = await computeElkLayout(build(seed, { dir: 'LR' }));
      const after = await computeElkLayout(build(seed, { dir: 'LR', leafOf: 'C' + (3 + (seed % 20)) }), { hints: hintsOf(before) });
      expect(movedFraction(before, after), `semilla ${seed}`).toBeLessThan(0.2);
    }
  }, 60_000);

  it('borrar una clase no mueve al resto', async () => {
    for (const seed of SEEDS) {
      const before = await computeElkLayout(build(seed));
      const after = await computeElkLayout(build(seed, { drop: 'C' + (20 + (seed % 9)) }), { hints: hintsOf(before) });
      expect(movedFraction(before, after), `semilla ${seed}`).toBeLessThan(0.2);
    }
  }, 60_000);

  it('recalcular el mismo diagrama: casi nada se mueve la primera vez y NADA después', async () => {
    for (const pkgs of [0, 4]) {
      const m = build(3, { pkgs });
      const fresh = await computeElkLayout(m);
      const stable = await computeElkLayout(m, { hints: hintsOf(fresh) });
      // El colocador estándar y el interactivo no coinciden al píxel: se admite algún ajuste suelto.
      expect(movedFraction(fresh, stable, 50), `pkgs ${pkgs}`).toBeLessThan(0.2);
      // Ya sobre un layout estable el recálculo es exacto.
      const again = await computeElkLayout(m, { hints: hintsOf(stable) });
      expect(movedFraction(stable, again, 0.01), `pkgs ${pkgs}`).toBe(0);
    }
  }, 60_000);

  it('el resultado con pistas es un layout válido: aristas finitas y sin tarjetas solapadas', async () => {
    const before = await computeElkLayout(build(2, { pkgs: 3 }));
    const after = await computeElkLayout(build(2, { pkgs: 3, leafOf: 'C7' }), { hints: hintsOf(before) });
    expect(after.nodes).toHaveLength(31);
    expect(after.edges.length).toBeGreaterThan(30);
    for (const e of after.edges) {
      expect(e.points.length).toBeGreaterThanOrEqual(4);
      expect(e.points.every(Number.isFinite)).toBe(true);
    }
    for (let i = 0; i < after.nodes.length; i++) {
      for (let j = i + 1; j < after.nodes.length; j++) {
        const a = after.nodes[i] as NodeBox, b = after.nodes[j] as NodeBox;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.id} solapa con ${b.id}`).toBe(false);
      }
    }
  }, 60_000);

  it('pistas de otro diagrama (casi ningún id en común) se ignoran: layout desde cero', async () => {
    const stranger = hintsOf(await computeElkLayout(build(9, { n: 12 })));
    const foreign = Object.fromEntries(Object.entries(stranger).map(([k, v]) => ['otro_' + k, v]));
    const m = build(4);
    const plain = await computeElkLayout(m);
    const hinted = await computeElkLayout(m, { hints: foreign });
    expect(movedFraction(plain, hinted, 0.5)).toBe(0);
  }, 60_000);

  it('dagre (respaldo) no respeta posiciones pero ancla el conjunto: sin supervivientes desplazados en bloque', () => {
    const m = build(5);
    const first = computeLayout(m);
    const shifted = { ...first, nodes: first.nodes.map((n) => ({ ...n, x: n.x + 500, y: n.y + 300 })) };
    const again = computeLayout(m, { hints: hintsOf(shifted) });
    const byId = new Map(again.nodes.map((n) => [n.id, n]));
    for (const n of shifted.nodes) {
      expect(byId.get(n.id)?.x).toBeCloseTo(n.x, 3);
      expect(byId.get(n.id)?.y).toBeCloseTo(n.y, 3);
    }
  });
});

describe('paquetes tras un layout estable (regresión: cajas estiradas por la deformación del eje de flujo)', () => {
  const pkg = (i: number): string => (i % 3 === 0 ? 'zoo.core' : i % 3 === 1 ? 'zoo.mammals' : 'zoo.birds');
  const names = ['Animal', 'Mammal', 'Bird', 'Dog', 'Cat', 'Eagle', 'Owl', 'Puppy', 'Kitten', 'Vet', 'Owner'];
  const parent: Record<string, string> = { Mammal: 'Animal', Bird: 'Animal', Dog: 'Mammal', Cat: 'Mammal', Eagle: 'Bird', Owl: 'Bird', Puppy: 'Dog', Kitten: 'Cat' };
  const zoo = (extra: boolean): DiagramModel => {
    const types = names.map((n, i) => typeNode(n, { packageName: pkg(i) }));
    const rels = Object.entries(parent).map(([c, p]) => rel(c, p, { type: 'EXTENDS' }));
    rels.push(rel('Owner', 'Dog'), rel('Vet', 'Owner'));
    if (extra) {
      types.push(typeNode('Parrot', { packageName: 'zoo.birds' }));
      rels.push(rel('Parrot', 'Bird', { type: 'EXTENDS' }));
    }
    return diagram(types, rels);
  };

  it('cada caja es la envolvente ajustada de sus miembros (+ el padding de ELK)', async () => {
    const before = await computeElkLayout(zoo(false));
    const after = await computeElkLayout(zoo(true), { hints: hintsOf(before) });
    expect(after.packages).toHaveLength(3);
    for (const p of after.packages) {
      const m = after.nodes.filter((n) => n.packageName === p.name);
      expect(p.x).toBeCloseTo(Math.min(...m.map((n) => n.x)) - 16, 3);
      expect(p.y).toBeCloseTo(Math.min(...m.map((n) => n.y)) - 30, 3);
      expect(p.x + p.w).toBeCloseTo(Math.max(...m.map((n) => n.x + n.w)) + 16, 3);
      expect(p.y + p.h).toBeCloseTo(Math.max(...m.map((n) => n.y + n.h)) + 16, 3);
    }
  });

  it('las cajas no se solapan entre sí ni contienen tarjetas de otro paquete', async () => {
    const before = await computeElkLayout(zoo(false));
    const after = await computeElkLayout(zoo(true), { hints: hintsOf(before) });
    const ps = after.packages;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i] as (typeof ps)[number], b = ps[j] as (typeof ps)[number];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.name} solapa con ${b.name}`).toBe(false);
      }
      for (const n of after.nodes.filter((q) => q.packageName !== (ps[i] as (typeof ps)[number]).name)) {
        const p = ps[i] as (typeof ps)[number];
        expect(n.x + n.w <= p.x || n.x >= p.x + p.w || n.y + n.h <= p.y || n.y >= p.y + p.h, `${n.id} dentro de ${p.name}`).toBe(true);
      }
    }
  });

  it('las cajas de los paquetes que no cambian se quedan donde estaban', async () => {
    const before = await computeElkLayout(zoo(false));
    const after = await computeElkLayout(zoo(true), { hints: hintsOf(before) });
    for (const name of ['zoo.core', 'zoo.mammals']) {
      const a = before.packages.find((p) => p.name === name);
      const b = after.packages.find((p) => p.name === name);
      expect(Math.abs((b?.x ?? 1e9) - (a?.x ?? 0)), name).toBeLessThan(50);
      expect(Math.abs((b?.y ?? 1e9) - (a?.y ?? 0)), name).toBeLessThan(50);
      expect(Math.abs((b?.w ?? 1e9) - (a?.w ?? 0)), name).toBeLessThan(50);
      expect(Math.abs((b?.h ?? 1e9) - (a?.h ?? 0)), name).toBeLessThan(50);
    }
  });
});
