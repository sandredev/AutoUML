// tests/presentation/diagram/AnalysisPanel.test.tsx — panel del diagnóstico de arquitectura (T9).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { analyzeDiagram } from '../../../src/domain/analysis/analyze';
import type { DiagramModel } from '../../../src/domain/diagram/model';
import { AnalysisPanel, MAX_LIST_ITEMS } from '../../../src/presentation/diagram/AnalysisPanel';
import { buildOverlay, type HeatMetric } from '../../../src/presentation/diagram/analysis/overlay';
import { DEFAULT_LABELS } from '../../../src/presentation/diagram/labels';
import { diagram, rel, typeNode } from '../../helpers/diagramBuilders';

const L = DEFAULT_LABELS.analysis;

function model(): DiagramModel {
  const m = diagram(
    [typeNode('A', { packageName: 'ui', name: 'Alfa' }), typeNode('B', { packageName: 'ui' }), typeNode('C', { packageName: 'core' })],
    [rel('A', 'B'), rel('B', 'A'), rel('C', 'B'), rel('C', 'C')],
  );
  m.packages = [
    { name: 'ui', typeIds: ['A', 'B'], layer: 'ui' },
    { name: 'core', typeIds: ['C'], layer: 'core' },
  ];
  return m;
}

function render(m: DiagramModel, metric: HeatMetric = 'none', extra: Partial<Parameters<typeof AnalysisPanel>[0]> = {}): string {
  const analysis = analyzeDiagram(m);
  return renderToStaticMarkup(
    <AnalysisPanel
      model={m}
      analysis={analysis}
      overlay={buildOverlay(analysis, metric)}
      labels={DEFAULT_LABELS}
      metric={metric}
      includeExternal={false}
      onMetricChange={vi.fn()}
      onIncludeExternalChange={vi.fn()}
      onGoTo={vi.fn()}
      onClose={vi.fn()}
      {...extra}
    />,
  );
}

describe('AnalysisPanel', () => {
  it('región etiquetada con resumen, secciones con contador y los mismos textos que el informe', () => {
    const html = render(model());
    expect(html).toContain('role="region"');
    expect(html).toContain(`aria-label="${L.panelAria}"`);
    expect(html).toContain('3 tipos analizados · 3 dependencias.');
    expect(html).toContain(L.cycles.replace('{n}', '1'));
    expect(html).toContain(L.selfLoops.replace('{n}', '1'));
    expect(html).toContain(L.violations.replace('{n}', '1'));
  });

  it('cada ciclo, autorreferencia y violación es un botón con nombres visibles', () => {
    const html = render(model());
    expect(html).toMatch(/<button[^>]*>Alfa → B → Alfa<\/button>/);
    // core está debajo de ui: C → B va hacia arriba.
    expect(html).toMatch(/<button[^>]*>C \(core\) → B \(ui\)<\/button>/);
    expect(html).toContain(`title="${L.goTo.replace('{name}', 'Alfa')}"`);
  });

  it('sin hallazgos: "Ninguno."', () => {
    const html = render(diagram([typeNode('Solo')]));
    expect(html).toContain(L.none);
    expect(html).toContain(L.layersNone);
  });

  it('con métrica: leyenda de 5 pasos con mínimo y máximo y descripción accesible', () => {
    const html = render(model(), 'fanIn');
    expect(html.match(/analysis-legend-step/g)).toHaveLength(5);
    expect(html).toContain(`aria-label="${L.legendRange.replace('{metric}', L.heatFanIn).replace('{min}', '0').replace('{max}', '2')}"`);
    expect(render(model(), 'none')).not.toContain('analysis-legend-step');
  });

  it('exportar: deshabilitado si el host no lo admite', () => {
    expect(render(model())).toMatch(/<button[^>]*disabled=""[^>]*>Exportar informe…<\/button>/);
    expect(render(model(), 'none', { onExport: vi.fn() })).not.toMatch(/disabled=""[^>]*>Exportar informe…/);
  });

  it(`listas largas: como mucho ${MAX_LIST_ITEMS} elementos y "+N más"`, () => {
    const n = MAX_LIST_ITEMS + 7;
    const types = Array.from({ length: n }, (_, i) => typeNode('S' + String(i).padStart(3, '0')));
    const html = render(diagram(types, types.map((t) => rel(t.id, t.id))));
    expect(html).toContain('… +7 más');
  });
});
