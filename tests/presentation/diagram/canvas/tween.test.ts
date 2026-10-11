import { describe, expect, it } from 'vitest';
import {
  ANIMATION_MAX_NODES, blendLayouts, canAnimate, changedTypes, cubicBezier, EASE_IN_OUT, EASE_OUT, HALO_MS, haloIntensity,
  LAYOUT_MS, layoutsDiffer, lerpView, REDUCED_LAYOUT_MS, snapshotOf, VIEW_MS,
} from '../../../../src/presentation/diagram/canvas/tween';
import type { EdgePath, LayoutResult, NodeBox } from '../../../../src/presentation/diagram/types';
import { diagram, rel, typeNode } from '../../../helpers/diagramBuilders';

const box = (id: string, x: number, y: number, w = 100, h = 40): NodeBox => ({ id, x, y, w, h });
const edge = (source: string, target: string, points: number[], extra: Partial<EdgePath> = {}): EdgePath => ({
  source, target, type: 'ASSOCIATION', points, ...extra,
});
const layout = (nodes: NodeBox[], edges: EdgePath[] = [], extra: Partial<LayoutResult> = {}): LayoutResult => ({
  nodes, edges, packages: [], bounds: { x: 0, y: 0, w: 500, h: 500 }, ...extra,
});

describe('curvas y duraciones', () => {
  it('cubic-bezier: extremos exactos y monótona', () => {
    for (const f of [EASE_OUT, EASE_IN_OUT]) {
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
      let prev = -1;
      for (let i = 0; i <= 100; i++) {
        const v = f(i / 100);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });

  it('ease-out arranca rápido; ease-in-out arranca lento y asienta al final', () => {
    expect(EASE_OUT(0.2)).toBeGreaterThan(0.5); // ya más de la mitad a un 20 % del tiempo
    expect(EASE_IN_OUT(0.2)).toBeLessThan(0.1); // arranque lento
    expect(EASE_IN_OUT(0.5)).toBeGreaterThan(0.5); // (0.77, 0, 0.175, 1) no es simétrica: frena más tarde
    expect(EASE_IN_OUT(0.5)).toBeLessThan(0.7);
    expect(EASE_IN_OUT(0.9)).toBeGreaterThan(0.95); // asienta
  });

  it('una curva lineal devuelve t', () => {
    const lin = cubicBezier(0, 0, 1, 1);
    expect(lin(0.37)).toBeCloseTo(0.37, 4);
  });

  it('las duraciones de UI se mantienen por debajo de 300 ms', () => {
    expect(LAYOUT_MS).toBeLessThan(300);
    expect(VIEW_MS).toBeLessThan(300);
    expect(REDUCED_LAYOUT_MS).toBeLessThan(LAYOUT_MS);
  });
});

describe('lerpView', () => {
  const a = { scale: 1, tx: 0, ty: 0 };
  const b = { scale: 4, tx: -600, ty: -300 };

  it('extremos exactos', () => {
    expect(lerpView(a, b, 0, 800, 600)).toEqual(a);
    expect(lerpView(a, b, 1, 800, 600)).toEqual(b);
  });

  it('el zoom cambia de forma exponencial (a mitad: media geométrica)', () => {
    expect(lerpView(a, b, 0.5, 800, 600).scale).toBeCloseTo(2, 5);
  });

  it('el centro de la pantalla recorre el mundo en línea recta', () => {
    const w = 800, h = 600;
    const mid = lerpView(a, b, 0.5, w, h);
    const centerOf = (v: typeof a): { x: number; y: number } => ({ x: (w / 2 - v.tx) / v.scale, y: (h / 2 - v.ty) / v.scale });
    const ca = centerOf(a), cb = centerOf(b), cm = centerOf(mid);
    expect(cm.x).toBeCloseTo((ca.x + cb.x) / 2, 5);
    expect(cm.y).toBeCloseTo((ca.y + cb.y) / 2, 5);
  });
});

describe('blendLayouts', () => {
  const from = layout([box('A', 0, 0), box('B', 200, 0), box('GONE', 400, 0)], [edge('A', 'B', [50, 40, 250, 40])]);
  const to = layout([box('A', 0, 100), box('B', 200, 0), box('NEW', 400, 100)], [edge('A', 'B', [50, 140, 250, 40]), edge('A', 'NEW', [50, 140, 450, 140])]);

  it('t = 0 parte del layout anterior y t = 1 llega al final y termina', () => {
    const f0 = blendLayouts({ layout: from }, to, 0);
    expect(f0.layout.nodes.find((n) => n.id === 'A')).toMatchObject({ x: 0, y: 0 });
    expect(f0.done).toBe(false);
    const f1 = blendLayouts({ layout: from }, to, 1);
    expect(f1.layout.nodes.map((n) => n.id)).toEqual(['A', 'B', 'NEW']); // GONE ya no está
    expect(f1.layout.nodes.find((n) => n.id === 'A')).toMatchObject({ x: 0, y: 100 });
    expect(f1.done).toBe(true);
    expect(f1.fx.nodes.get('NEW')?.alpha).toBeCloseTo(1, 5);
  });

  it('las tarjetas del layout final conservan su orden (los índices de foco siguen valiendo)', () => {
    const f = blendLayouts({ layout: from }, to, 0.15);
    expect(f.layout.nodes.slice(0, 3).map((n) => n.id)).toEqual(['A', 'B', 'NEW']);
    expect(f.layout.nodes[3]?.id).toBe('GONE'); // las que salen, detrás
    expect(f.layout.edges.slice(0, 2).map((e) => e.target)).toEqual(['B', 'NEW']);
  });

  it('las tarjetas que se mueven recorren el camino con ease-in-out', () => {
    const f = blendLayouts({ layout: from }, to, 0.5);
    expect(f.layout.nodes.find((n) => n.id === 'A')?.y).toBeCloseTo(100 * EASE_IN_OUT(0.5), 5);
    const early = blendLayouts({ layout: from }, to, 0.2);
    expect(early.layout.nodes.find((n) => n.id === 'A')?.y).toBeLessThan(10); // arranca lento
  });

  it('el tamaño de una tarjeta salta al final (el texto no cabe en una caja a medias); el de un paquete se interpola', () => {
    const a = layout([box('A', 0, 0, 100, 40)], [], { packages: [{ name: 'p', x: 0, y: 0, w: 100, h: 100 }] });
    const b = layout([box('A', 0, 100, 100, 90)], [], { packages: [{ name: 'p', x: 0, y: 0, w: 300, h: 100 }] });
    const f = blendLayouts({ layout: a }, b, 0.1);
    expect(f.layout.nodes[0]).toMatchObject({ h: 90, w: 100 });
    expect(f.layout.packages[0]?.w).toBeGreaterThan(100);
    expect(f.layout.packages[0]?.w).toBeLessThan(300);
  });

  it('las nuevas entran con opacidad y escala 0.95 → 1, nunca desde 0, y con un pequeño retardo', () => {
    const start = blendLayouts({ layout: from }, to, 0).fx.nodes.get('NEW');
    expect(start?.alpha).toBe(0);
    expect(start?.scale).toBeCloseTo(0.95, 5); // nunca scale(0)
    const mid = blendLayouts({ layout: from }, to, 0.6).fx.nodes.get('NEW');
    expect(mid?.alpha).toBeGreaterThan(0.5);
    expect(mid?.scale).toBeGreaterThan(0.95);
    expect(mid?.scale).toBeLessThanOrEqual(1);
    expect(blendLayouts({ layout: from }, to, 0.1).fx.nodes.get('NEW')?.alpha).toBe(0); // aún en el retardo
  });

  it('las que salen se desvanecen donde estaban y antes de que acabe la transición (salir es más rápido que entrar)', () => {
    const half = blendLayouts({ layout: from }, to, 0.3);
    const gone = half.layout.nodes.find((n) => n.id === 'GONE');
    expect(gone).toMatchObject({ x: 400, y: 0 });
    expect(half.fx.nodes.get('GONE')?.alpha).toBeLessThan(1);
    const late = blendLayouts({ layout: from }, to, 0.7);
    expect(late.layout.nodes.some((n) => n.id === 'GONE')).toBe(false); // ya desaparecida
    expect(late.layout.nodes.some((n) => n.id === 'NEW')).toBe(true); // la nueva aún está entrando
    expect(late.fx.nodes.get('NEW')?.alpha).toBeLessThan(1);
  });

  it('aristas con el mismo número de puntos se interpolan; las nuevas aparecen', () => {
    const f = blendLayouts({ layout: from }, to, 0.5);
    const ab = f.layout.edges[0] as EdgePath;
    expect(ab.points[1]).toBeCloseTo(40 + 100 * EASE_IN_OUT(0.5), 5); // 40 → 140 con la misma curva que las tarjetas
    expect(f.fx.edges.get(1)).toBeDefined(); // A→NEW es nueva: entra con fundido
    expect(f.fx.edges.get(0)).toBeUndefined(); // A→B se dibuja normal
  });

  it('una arista que cambia de ruta (otro nº de puntos) funde: la vieja sale y la nueva entra', () => {
    const a = layout([box('A', 0, 0), box('B', 200, 0)], [edge('A', 'B', [50, 40, 250, 40], { rel: 3 })]);
    const b = layout([box('A', 0, 0), box('B', 200, 0)], [edge('A', 'B', [50, 40, 50, 80, 250, 80, 250, 40], { rel: 0 })]);
    const f = blendLayouts({ layout: a }, b, 0);
    expect(f.layout.edges).toHaveLength(2);
    const leaving = f.layout.edges[1] as EdgePath;
    expect(leaving.points).toEqual([50, 40, 250, 40]);
    expect(leaving.rel).toBeUndefined(); // `rel` indexaba el modelo anterior
    expect(f.fx.edges.get(1)).toBe(1); // la vieja empieza entera…
    expect(f.fx.edges.get(0)).toBe(0); // …y la nueva, invisible
    const later = blendLayouts({ layout: a }, b, 0.15);
    expect(later.fx.edges.get(1)).toBeLessThan(1);
  });

  it('con movimiento reducido no hay desplazamiento ni escala, solo fundidos', () => {
    const f = blendLayouts({ layout: from }, to, 0.1, { reduceMotion: true });
    expect(f.layout.nodes.find((n) => n.id === 'A')).toMatchObject({ x: 0, y: 100 }); // ya en su sitio
    expect(f.fx.nodes.get('NEW')?.scale).toBe(1);
    expect(f.fx.nodes.get('GONE')?.alpha).toBeLessThan(1); // pero sí se desvanece
  });

  it('es interrumpible: la siguiente transición parte del fotograma que se ve, no del destino anterior', () => {
    const mid = blendLayouts({ layout: from }, to, 0.5);
    const third = layout([box('A', 0, 300), box('B', 200, 0), box('NEW', 400, 100)], [], { bounds: to.bounds });
    const resumed = blendLayouts(snapshotOf(mid), third, 0);
    const ya = resumed.layout.nodes.find((n) => n.id === 'A')?.y as number;
    expect(ya).toBeCloseTo(mid.layout.nodes.find((n) => n.id === 'A')?.y as number, 5); // sin salto
    expect(ya).not.toBeCloseTo(100, 0); // y no es el destino de la animación anterior
  });

  it('una tarjeta que venía entrando sigue desde su opacidad actual, no salta a 1', () => {
    const mid = blendLayouts({ layout: from }, to, 0.4); // NEW a medias
    const alphaThen = mid.fx.nodes.get('NEW')?.alpha as number;
    expect(alphaThen).toBeGreaterThan(0);
    expect(alphaThen).toBeLessThan(1);
    const resumed = blendLayouts(snapshotOf(mid), to, 0);
    expect(resumed.fx.nodes.get('NEW')?.alpha).toBeCloseTo(alphaThen, 5);
  });

  it('paquetes y notas entran, salen y se mueven por nombre / id', () => {
    const a = layout([box('A', 0, 0)], [], {
      packages: [{ name: 'p', x: 0, y: 0, w: 100, h: 100 }, { name: 'old', x: 0, y: 0, w: 10, h: 10 }],
      notes: [{ id: 'n1', x: 0, y: 0, w: 50, h: 20, lines: ['x'] }],
    });
    const b = layout([box('A', 0, 0)], [], {
      packages: [{ name: 'p', x: 100, y: 0, w: 100, h: 100 }, { name: 'nuevo', x: 0, y: 0, w: 10, h: 10 }],
      notes: [{ id: 'n2', x: 0, y: 0, w: 50, h: 20, lines: ['y'] }],
    });
    const f = blendLayouts({ layout: a }, b, 0.3);
    expect(f.layout.packages.map((p) => p.name)).toEqual(['p', 'nuevo', 'old']);
    expect(f.fx.packages.get('nuevo')).toBeDefined();
    expect(f.fx.packages.get('old')).toBeLessThan(1);
    expect(f.layout.notes?.map((n) => n.id)).toEqual(['n2', 'n1']);
  });
});

describe('layoutsDiffer / canAnimate', () => {
  it('misma geometría ⇒ nada que animar', () => {
    const a = layout([box('A', 0, 0)]);
    expect(layoutsDiffer(a, layout([box('A', 0.2, 0)]))).toBe(false);
    expect(layoutsDiffer(a, layout([box('A', 5, 0)]))).toBe(true);
    expect(layoutsDiffer(a, layout([box('A', 0, 0), box('B', 0, 0)]))).toBe(true);
    expect(layoutsDiffer(a, a)).toBe(false);
  });

  it('los diagramas enormes no se animan', () => {
    const big = layout(Array.from({ length: ANIMATION_MAX_NODES + 1 }, (_, i) => box('n' + i, i, 0)));
    expect(canAnimate(layout([box('A', 0, 0)]), big)).toBe(false);
    expect(canAnimate(layout([box('A', 0, 0)]), layout([box('A', 1, 1)]))).toBe(true);
  });
});

describe('changedTypes', () => {
  it('detecta tarjetas nuevas y con contenido modificado', () => {
    const before = diagram([typeNode('A'), typeNode('B'), typeNode('C')], [rel('A', 'B')]);
    const after = diagram(
      [typeNode('A'), typeNode('B', { stereotypes: ['service'] }), typeNode('C'), typeNode('D')],
      [rel('A', 'B')],
    );
    const { added, modified } = changedTypes(before, after);
    expect([...added]).toEqual(['D']);
    expect([...modified]).toEqual(['B']);
  });

  it('cambiar solo la línea del .puml (insertar texto encima) no cuenta como cambio', () => {
    const before = diagram([typeNode('A', { line: 3 }), typeNode('B', { line: 9 })]);
    const after = diagram([typeNode('A', { line: 13 }), typeNode('B', { line: 19 })]);
    const { added, modified } = changedTypes(before, after);
    expect(added.size + modified.size).toBe(0);
  });

  it('un miembro nuevo en una clase sí cuenta', () => {
    const member = { name: 'x', type: 'int', visibility: '+' as const, isStatic: false };
    const before = diagram([typeNode('A')]);
    const after = diagram([typeNode('A', { attributes: [member] })]);
    expect([...changedTypes(before, after).modified]).toEqual(['A']);
  });
});

describe('haloIntensity', () => {
  it('se mantiene al principio, se apaga suave y vale 0 al cabo de HALO_MS (2 s)', () => {
    expect(HALO_MS).toBe(2000);
    expect(haloIntensity(0)).toBe(1);
    expect(haloIntensity(300)).toBe(1);
    const mid = haloIntensity(1000);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(haloIntensity(HALO_MS)).toBe(0);
    expect(haloIntensity(HALO_MS + 500)).toBe(0);
  });

  it('nunca crece', () => {
    let prev = 2;
    for (let t = 0; t <= HALO_MS; t += 50) {
      const v = haloIntensity(t);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });
});
