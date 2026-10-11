// tests/presentation/diagram/analysis/drawOverlay.test.ts — la capa de análisis es SOLO dibujo (T9):
// desactivada da exactamente el dibujo de antes, no toca el layout, y marca ciclos/violaciones y calor.
import { describe, expect, it } from 'vitest';
import { analyzeDiagram } from '../../../../src/domain/analysis/analyze';
import type { DiagramModel } from '../../../../src/domain/diagram/model';
import { buildOverlay, type AnalysisOverlay } from '../../../../src/presentation/diagram/analysis/overlay';
import { drawDiagram, LIGHT_THEME, type Theme } from '../../../../src/presentation/diagram/canvas/draw';
import { buildIndex } from '../../../../src/presentation/diagram/canvas/spatial';
import type { LayoutResult } from '../../../../src/presentation/diagram/types';
import { diagram, rel, typeNode } from '../../../helpers/diagramBuilders';
import { recordingCanvas } from '../../../helpers/recordingCanvas';

const THEME: Theme = {
  ...LIGHT_THEME,
  heat: ['#000001', '#000002', '#000003', '#000004', '#000005'],
  markCycle: '#c0ffee',
  markViolation: '#facade',
};

function layoutOf(model: DiagramModel): LayoutResult {
  const nodes = model.types.map((t, i) => ({ id: t.id, x: i * 200, y: 0, w: 120, h: 60 }));
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const edges = model.relationships.map((r, i) => {
    const a = pos.get(r.source)!;
    const b = pos.get(r.target)!;
    return { source: r.source, target: r.target, type: r.type, rel: i, points: [a.x + 60, a.y + 60, b.x + 60, b.y + 60 + i * 10] };
  });
  return { nodes, edges, packages: [], bounds: { x: 0, y: 0, w: 600, h: 200 } };
}

function draw(model: DiagramModel, layout: LayoutResult, analysis?: AnalysisOverlay | null): string[] {
  const { ctx, log } = recordingCanvas();
  drawDiagram(ctx, {
    model, layout, index: buildIndex(layout), view: { scale: 1, tx: 0, ty: 0 }, viewW: 800, viewH: 600, dpr: 1,
    selectedId: null, theme: THEME, ...(analysis !== undefined ? { analysis } : {}),
  });
  return log;
}

const cyclic = (): DiagramModel => diagram([typeNode('A'), typeNode('B'), typeNode('C')], [rel('A', 'B'), rel('B', 'A'), rel('B', 'C')]);

describe('capa de análisis en drawDiagram', () => {
  it('desactivada (null o ausente) dibuja exactamente lo mismo', () => {
    const m = cyclic();
    const l = layoutOf(m);
    expect(draw(m, l, null)).toEqual(draw(m, l));
  });

  it('activa pero sin hallazgos ni métrica: idéntico al dibujo base', () => {
    const m = diagram([typeNode('A'), typeNode('B')], [rel('A', 'B')]);
    const l = layoutOf(m);
    expect(draw(m, l, buildOverlay(analyzeDiagram(m), 'none'))).toEqual(draw(m, l));
  });

  it('no modifica el layout (las posiciones manuales y el layout quedan intactos)', () => {
    const m = cyclic();
    const l = layoutOf(m);
    const before = JSON.stringify(l);
    draw(m, l, buildOverlay(analyzeDiagram(m), 'instability'));
    expect(JSON.stringify(l)).toBe(before);
  });

  it('las aristas del ciclo llevan su color y trazo doble; la que no está en el ciclo, no', () => {
    const m = cyclic();
    const log = draw(m, layoutOf(m), buildOverlay(analyzeDiagram(m), 'none'));
    // Dos aristas en ciclo (A→B, B→A): cada una se traza en el color de la marca a 3.5 px.
    const cycleStrokes = log.filter(
      (x, i) => x === 'strokeStyle="#c0ffee"' && log[i + 1] === 'setLineDash([])' && log[i + 2] === 'lineWidth=3.5',
    );
    expect(cycleStrokes).toHaveLength(2);
    expect(log.join('\n')).not.toContain('#facade');
  });

  it('una violación de capa se traza en raya y punto con su color', () => {
    const m = diagram([typeNode('A', { packageName: 'low' }), typeNode('B', { packageName: 'up' })], [rel('A', 'B')]);
    const log = draw(m, layoutOf(m), buildOverlay(analyzeDiagram(m, { layers: ['up', 'low'] }), 'none'));
    expect(log).toContain('strokeStyle="#facade"');
    expect(log).toContain('setLineDash([9,3,2,3])');
  });

  it('con métrica, cada tarjeta se rellena con el paso de calor del tema', () => {
    const m = cyclic();
    const log = draw(m, layoutOf(m), buildOverlay(analyzeDiagram(m), 'fanIn'));
    // Ca: A = 1, B = 1, C = 1 → max 1 → todas en el último tramo.
    expect(log.filter((x) => x === 'fillStyle="#000005"').length).toBeGreaterThanOrEqual(3);
    expect(log.join('\n')).not.toContain('#000001');
  });
});
