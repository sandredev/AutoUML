// tests/presentation/diagram/semantic/semanticDraw.test.ts — zoom semántico en drawDiagram (T10.5):
// lejos, bloques "nombre ×n" en lugar de las tarjetas empaquetadas; cerca, el dibujo de siempre; en medio, fundido.
import { describe, expect, it } from 'vitest';
import type { DiagramModel } from '../../../../src/domain/diagram/model';
import { drawDiagram, LIGHT_THEME } from '../../../../src/presentation/diagram/canvas/draw';
import { buildIndex } from '../../../../src/presentation/diagram/canvas/spatial';
import { blockAlpha, edgeWidth, SEMANTIC_HI, SEMANTIC_LO } from '../../../../src/presentation/diagram/semantic/aggregatePackages';
import type { LayoutResult, NodeBox } from '../../../../src/presentation/diagram/types';
import { diagram, rel, typeNode } from '../../../helpers/diagramBuilders';
import { recordingCanvas } from '../../../helpers/recordingCanvas';

// Más tarjetas que FULL_DETAIL_MAX_NODES para que actúe el LOD. Tamaño 17×13: fácil de reconocer en el registro.
const PER_PKG = 350;
const W = 17, H = 13;

function fixture(): { model: DiagramModel; layout: LayoutResult } {
  const nodes: NodeBox[] = [];
  for (const [p, ox] of [['a', 0], ['b', 2000]] as const) {
    for (let i = 0; i < PER_PKG; i++) {
      nodes.push({ id: `${p}${i}`, x: ox + 20 + (i % 20) * 40, y: 40 + Math.floor(i / 20) * 40, w: W, h: H, packageName: p });
    }
  }
  nodes.push({ id: 'L', x: 5000, y: 0, w: W, h: H });
  const types = nodes.map((n) => typeNode(n.id, n.packageName ? { packageName: n.packageName } : {}));
  const relationships = [rel('a0', 'b0'), rel('a1', 'b1'), rel('a2', 'b2'), rel('a0', 'a1'), rel('L', 'a0')];
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const edges = relationships.map((r, i) => {
    const s = pos.get(r.source)!, t = pos.get(r.target)!;
    return { source: r.source, target: r.target, type: r.type, rel: i, points: [s.x, s.y, t.x, t.y] };
  });
  const packages = [
    { name: 'a', x: 0, y: 0, w: 1000, h: 800 },
    { name: 'b', x: 2000, y: 0, w: 1000, h: 800 },
  ];
  return { model: diagram(types, relationships), layout: { nodes, edges, packages, bounds: { x: 0, y: 0, w: 5100, h: 800 } } };
}

function draw(scale: number, f = fixture()): string[] {
  const { ctx, log } = recordingCanvas();
  drawDiagram(ctx, {
    model: f.model, layout: f.layout, index: buildIndex(f.layout), view: { scale, tx: 0, ty: 0 },
    viewW: 800, viewH: 600, dpr: 1, selectedId: null, theme: LIGHT_THEME,
  });
  return log;
}

const cardRects = (log: string[]): string[] => log.filter((l) => l.startsWith('fillRect(') && l.endsWith(`,${W},${H})`));

describe('zoom semántico en drawDiagram', () => {
  it('lejos: un bloque por paquete con nombre y ×n; solo la tarjeta suelta sigue', () => {
    const log = draw(SEMANTIC_LO / 2);
    expect(log.some((l) => l.startsWith('fillText("a",'))).toBe(true);
    expect(log.some((l) => l.startsWith('fillText("×350",'))).toBe(true);
    expect(log.some((l) => l.startsWith('fillText("b",'))).toBe(true);
    expect(cardRects(log)).toEqual(['fillRect(5000,0,17,13)']);
  });

  it('lejos: arista agregada a→b con grosor de n=3; la interna y las fusionadas no se trazan', () => {
    const s = SEMANTIC_LO / 2;
    const log = draw(s);
    expect(log).toContain(`lineWidth=${round(edgeWidth(3) / s)}`);
    expect(log).toContain('moveTo(5000,0)'); // L→a0: un extremo suelto, sigue visible
    expect(log).not.toContain('moveTo(20,40)'); // a0→a1 (interna) y a0→b0 (fusionada)
  });

  it('cerca: el dibujo de siempre, sin bloques', () => {
    const log = draw(SEMANTIC_HI);
    expect(log.some((l) => l.startsWith('fillText("×'))).toBe(false);
    expect(log.some((l) => l.startsWith('fillText("a ×'))).toBe(false);
    expect(log.some((l) => /^globalAlpha=0\./.test(l))).toBe(false);
  });

  it('en medio: bloques y tarjetas a la vez, con opacidades complementarias', () => {
    const s = SEMANTIC_LO + (SEMANTIC_HI - SEMANTIC_LO) * 0.3;
    const log = draw(s);
    const ba = blockAlpha(s);
    expect(ba).toBeGreaterThan(0);
    expect(ba).toBeLessThan(1);
    expect(log).toContain(`globalAlpha=${round(ba)}`);
    expect(log).toContain(`globalAlpha=${round(1 - ba)}`);
    expect(log.some((l) => l.startsWith('fillText("×350",'))).toBe(true);
    expect(cardRects(log).length).toBeGreaterThan(1);
  });

  it('no modifica el layout a ningún zoom', () => {
    const f = fixture();
    const before = JSON.stringify(f.layout);
    for (const s of [0.02, SEMANTIC_LO, 0.15, SEMANTIC_HI, 1]) draw(s, f);
    expect(JSON.stringify(f.layout)).toBe(before);
  });

  it('con pocas tarjetas no hay bloques aunque se aleje mucho', () => {
    const f = fixture();
    const nodes = f.layout.nodes.filter((n) => n.id === 'L' || n.id.endsWith('0'));
    const log = draw(0.01, { model: f.model, layout: { ...f.layout, nodes, edges: [] } });
    expect(log.some((l) => l.startsWith('fillText("×'))).toBe(false);
  });
});

describe('rendimiento del zoom semántico (1000 clases / 2000 aristas)', () => {
  it('cada fotograma se dibuja en < 33 ms (≥ 30 FPS) a cualquier zoom', () => {
    let seed = 42;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const nodes: NodeBox[] = Array.from({ length: 1000 }, (_, i) => {
      const p = i % 20, k = Math.floor(i / 20);
      return { id: 'T' + i, x: (p % 5) * 2000 + 20 + (k % 7) * 250, y: Math.floor(p / 5) * 2000 + 40 + Math.floor(k / 7) * 200, w: 200, h: 120, packageName: 'p' + p + (i % 3 ? '.sub' : '') };
    });
    const packages = Array.from({ length: 20 }, (_, p) => ({ name: 'p' + p, x: (p % 5) * 2000, y: Math.floor(p / 5) * 2000, w: 1900, h: 1900 }));
    const types = nodes.map((n) => typeNode(n.id, { packageName: n.packageName! }));
    const relationships = Array.from({ length: 2000 }, () => rel('T' + Math.floor(rnd() * 1000), 'T' + Math.floor(rnd() * 1000)));
    const pos = new Map(nodes.map((n) => [n.id, n]));
    const edges = relationships.map((r, i) => {
      const s = pos.get(r.source)!, t = pos.get(r.target)!;
      return { source: r.source, target: r.target, type: r.type, rel: i, points: [s.x + 100, s.y + 120, t.x + 100, t.y] };
    });
    const layout: LayoutResult = { nodes, edges, packages, bounds: { x: 0, y: 0, w: 10000, h: 8000 } };
    const model = diagram(types, relationships);
    const index = buildIndex(layout);
    const ctx = noopCanvas();
    const frame = (scale: number): void =>
      drawDiagram(ctx, { model, layout, index, view: { scale, tx: 0, ty: 0 }, viewW: 1600, viewH: 1000, dpr: 1, selectedId: null, theme: LIGHT_THEME });

    for (const scale of [0.05, SEMANTIC_LO, 0.13, 0.15, 0.18, SEMANTIC_HI, 0.3]) {
      frame(scale); // calentamiento (memo de la agregación, cachés de texto)
      // Mediana de 7 fotogramas: un pico aislado (GC, otros tests en paralelo) no es un fotograma lento.
      const times = Array.from({ length: 7 }, () => {
        const t0 = performance.now();
        frame(scale);
        return performance.now() - t0;
      }).sort((x, y) => x - y);
      expect(times[3]).toBeLessThan(33);
    }
  });
});

function round(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

/** Canvas que no hace nada (sin el coste de grabar): mide solo el trabajo de drawDiagram. */
function noopCanvas(): CanvasRenderingContext2D {
  const noop = (): undefined => undefined;
  const measure = (text: string): { width: number } => ({ width: text.length * 7 });
  return new Proxy({} as CanvasRenderingContext2D, {
    get: (t, key) => (key in t ? (t as unknown as Record<PropertyKey, unknown>)[key] : key === 'measureText' ? measure : key === 'getLineDash' ? () => [] : noop),
    set: (t, key, v) => (((t as unknown as Record<PropertyKey, unknown>)[key] = v), true),
  });
}
