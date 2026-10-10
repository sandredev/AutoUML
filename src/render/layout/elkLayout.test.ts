import { describe, expect, it } from 'vitest';
import type { DiagramModel, RelationshipModel, TypeNode } from '../../core/model';
import { computeElkLayout, layeringOf, runLayoutWithFallback } from './elkLayout';

function t(id: string, declaredKind: TypeNode['declaredKind'] = 'class'): TypeNode {
  return {
    id, name: id, packageName: '', declaredKind,
    category: declaredKind === 'interface' ? 'interface' : 'class',
    isAbstract: false, isSealed: false, isExternal: false, implicit: false,
    stereotypes: [], attributes: [], methods: [], constructors: [], enumConstants: [], line: 1,
  };
}

function model(): DiagramModel {
  return {
    types: [t('Padre'), t('Hijo'), t('IFace', 'interface')],
    relationships: [
      { source: 'Hijo', target: 'Padre', type: 'EXTENDS', line: 1 },
      { source: 'Hijo', target: 'IFace', type: 'IMPLEMENTS', line: 2 },
    ],
    packages: [],
    summaryMode: false,
    issues: [],
  };
}

describe('computeElkLayout', () => {
  it('padre encima del hijo en TB', async () => {
    const r = await computeElkLayout(model());
    const p = r.nodes.find((n) => n.id === 'Padre');
    const h = r.nodes.find((n) => n.id === 'Hijo');
    expect(p && h).toBeTruthy();
    expect((p?.y ?? 0) + (p?.h ?? 0)).toBeLessThanOrEqual(h?.y ?? 0);
  });

  it('aristas con ≥4 números finitos', async () => {
    const r = await computeElkLayout(model());
    expect(r.edges.length).toBe(2);
    for (const e of r.edges) {
      expect(e.points.length).toBeGreaterThanOrEqual(4);
      expect(e.points.every(Number.isFinite)).toBe(true);
    }
  });

  it('bucle de una clase consigo misma: ortogonal con rel/self', async () => {
    const m = model();
    m.types.push(t('C'));
    m.relationships.push({ source: 'C', target: 'C', type: 'ASSOCIATION', line: 3 });
    const r = await computeElkLayout(m);
    const loop = r.edges.find((e) => e.source === 'C' && e.target === 'C');
    expect(loop).toBeTruthy();
    expect(loop?.routing).toBe('orthogonal');
    expect(loop?.self).toBe(true);
    expect(loop?.rel).toBe(2);
    expect(loop?.points.length).toBeGreaterThanOrEqual(8);
    expect(loop?.points.every(Number.isFinite)).toBe(true);
  });
});

describe('runLayoutWithFallback', () => {
  it('si ELK lanza, cae a dagre con fallback visible', async () => {
    const r = await runLayoutWithFallback(model(), undefined, {
      elk: () => Promise.reject(new Error('boom')),
    });
    expect(r.engine).toBe('dagre');
    expect(r.fallback).toBeTruthy();
    expect(r.result.nodes.length).toBe(3);
  });

  it('timeoutMs ya no tiene efecto (el timeout vive en useLayout)', async () => {
    // runLayoutWithFallback solo cae a dagre ante ERRORES; si ELK cuelga, es useLayout
    // quien lo mata con worker.terminate(). Este test fija que un ELK que resuelve
    // se usa aunque se pase el antiguo timeoutMs.
    const r = await runLayoutWithFallback(model(), undefined, { timeoutMs: 1 });
    expect(r.engine).toBe('elk');
    expect(r.fallback).toBeUndefined();
  });
});

describe('layeringOf', () => {
  const rel = (over: Partial<RelationshipModel> = {}): RelationshipModel => ({
    source: 'A', target: 'B', type: 'ASSOCIATION', line: 1, ...over,
  });
  it('herencia sin hint: padre antes que hijo, fuerte', () => {
    expect(layeringOf(rel({ type: 'EXTENDS' }), 'TB')).toEqual({ reversed: true, strong: true });
    expect(layeringOf(rel({ type: 'IMPLEMENTS' }), 'LR')).toEqual({ reversed: true, strong: true });
  });
  it('hint en el eje manda sobre el tipo', () => {
    expect(layeringOf(rel({ hint: 'down' }), 'TB')).toEqual({ reversed: false, strong: true });
    expect(layeringOf(rel({ hint: 'up' }), 'TB')).toEqual({ reversed: true, strong: true });
    expect(layeringOf(rel({ type: 'EXTENDS', hint: 'down' }), 'TB')).toEqual({ reversed: false, strong: true });
    expect(layeringOf(rel({ hint: 'right' }), 'LR')).toEqual({ reversed: false, strong: true });
    expect(layeringOf(rel({ hint: 'left' }), 'LR')).toEqual({ reversed: true, strong: true });
  });
  it('hint perpendicular se ignora (débil según tipo)', () => {
    expect(layeringOf(rel({ hint: 'left' }), 'TB')).toEqual({ reversed: false, strong: false });
    expect(layeringOf(rel({ type: 'EXTENDS', hint: 'left' }), 'TB')).toEqual({ reversed: true, strong: true });
    expect(layeringOf(rel({ hint: 'up' }), 'LR')).toEqual({ reversed: false, strong: false });
  });
  it('sin hint ni herencia: débil sin invertir', () => {
    expect(layeringOf(rel(), 'TB')).toEqual({ reversed: false, strong: false });
  });
});

describe('computeElkLayout con direction', () => {
  it("en LR el padre queda a la izquierda del hijo", async () => {
    const m = model();
    m.direction = 'LR';
    const r = await computeElkLayout(m);
    const p = r.nodes.find((n) => n.id === 'Padre');
    const h = r.nodes.find((n) => n.id === 'Hijo');
    expect(p && h).toBeTruthy();
    expect((p?.x ?? 0) + (p?.w ?? 0)).toBeLessThanOrEqual(h?.x ?? 0);
  });
});

function pkgModel(): DiagramModel {
  const tp = (id: string, p: string): TypeNode => ({ ...t(id), packageName: p });
  return {
    types: [tp('A', 'p1'), tp('B', 'p1'), tp('C', 'p2'), tp('D', 'p2'), t('E')],
    relationships: [
      { source: 'B', target: 'A', type: 'EXTENDS', line: 1 },
      { source: 'C', target: 'A', type: 'ASSOCIATION', line: 2 },
      { source: 'D', target: 'C', type: 'IMPLEMENTS', line: 3 },
      { source: 'E', target: 'D', type: 'DEPENDENCY', line: 4 },
    ],
    packages: [
      { name: 'p1', typeIds: ['A', 'B'] },
      { name: 'p2', typeIds: ['C', 'D'] },
    ],
    summaryMode: false,
    issues: [],
  };
}

/** Distancia de un punto al borde/interior de una caja (0 = toca la caja). */
function distTo(n: { x: number; y: number; w: number; h: number }, x: number, y: number): number {
  const dx = Math.max(n.x - x, 0, x - (n.x + n.w));
  const dy = Math.max(n.y - y, 0, y - (n.y + n.h));
  return Math.hypot(dx, dy);
}

describe('computeElkLayout con paquetes', () => {
  it('las aristas (también las internas de un paquete) empiezan y terminan en sus tarjetas', async () => {
    const r = await computeElkLayout(pkgModel());
    const byId = new Map(r.nodes.map((n) => [n.id, n] as const));
    expect(r.edges.length).toBe(4);
    for (const e of r.edges) {
      const p = e.points;
      const s = byId.get(e.source);
      const d = byId.get(e.target);
      expect(s && d).toBeTruthy();
      if (!s || !d) continue;
      expect(distTo(s, p[0] as number, p[1] as number)).toBeLessThan(1);
      expect(distTo(d, p[p.length - 2] as number, p[p.length - 1] as number)).toBeLessThan(1);
    }
  });

  it('bounds contiene nodos, paquetes y todos los puntos de las aristas', async () => {
    const r = await computeElkLayout(pkgModel());
    const b = r.bounds;
    const inside = (x: number, y: number): boolean =>
      x >= b.x - 0.5 && y >= b.y - 0.5 && x <= b.x + b.w + 0.5 && y <= b.y + b.h + 0.5;
    for (const n of [...r.nodes, ...r.packages]) {
      expect(inside(n.x, n.y) && inside(n.x + n.w, n.y + n.h)).toBe(true);
    }
    for (const e of r.edges) {
      for (let i = 0; i < e.points.length; i += 2) expect(inside(e.points[i] as number, e.points[i + 1] as number)).toBe(true);
    }
  });

  it('padre arriba también entre paquetes y con implementaciones', async () => {
    const r = await computeElkLayout(pkgModel());
    const y = (id: string): number => r.nodes.find((n) => n.id === id)?.y ?? NaN;
    expect(y('A')).toBeLessThan(y('B'));
    expect(y('C')).toBeLessThan(y('D'));
  });
});
