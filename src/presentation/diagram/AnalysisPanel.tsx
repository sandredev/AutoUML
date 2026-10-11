// src/presentation/diagram/AnalysisPanel.tsx — panel del diagnóstico de arquitectura (T9).
// Columna lateral del visor (no tapa el lienzo ni el minimapa). Lee el MISMO DiagramAnalysis y los mismos
// textos que el informe Markdown, así que lo que se ve coincide con lo que se exporta. Cada hallazgo es un
// botón que lleva la cámara a su clase: con ratón vuela; con teclado (Intro/Espacio, event.detail === 0) salta.
import { memo } from 'react';
import type { JSX, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { DiagramAnalysis } from '../../domain/analysis/analyze';
import { CATEGORY_ORDER, fillTemplate, fixed2, namers } from '../../domain/analysis/report';
import type { DiagramModel } from '../../domain/diagram/model';
import type { AnalysisOverlay, HeatMetric } from './analysis/overlay';
import { HEAT_STEPS } from './analysis/overlay';
import type { ViewerLabels } from './labels';

/** Elementos de una lista que se pintan; el resto se resume en "… +N más" (el informe los tiene todos). */
export const MAX_LIST_ITEMS = 100;

interface Props {
  model: DiagramModel;
  analysis: DiagramAnalysis;
  overlay: AnalysisOverlay;
  labels: ViewerLabels;
  metric: HeatMetric;
  includeExternal: boolean;
  onMetricChange: (m: HeatMetric) => void;
  onIncludeExternalChange: (v: boolean) => void;
  /** Lleva la cámara a la clase y la selecciona; `animate` false si lo pidió el teclado. */
  onGoTo: (id: string, animate: boolean) => void;
  onClose: () => void;
  /** Sin él, "Exportar informe" sale deshabilitado (p. ej. fuera de Electron). */
  onExport?: (() => void) | undefined;
  id?: string;
}

const METRICS: HeatMetric[] = ['none', 'fanIn', 'fanOut', 'instability'];

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <details className="analysis-section" open>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

export const AnalysisPanel = memo(function AnalysisPanel({
  model, analysis: a, overlay, labels, metric, includeExternal, onMetricChange, onIncludeExternalChange, onGoTo, onClose, onExport, id,
}: Props): JSX.Element {
  const l = labels.analysis;
  const name = namers(model, l);
  const go = (target: string) => (e: ReactMouseEvent<HTMLButtonElement>): void => onGoTo(target, e.detail !== 0);
  const more = (total: number): JSX.Element | null =>
    total > MAX_LIST_ITEMS ? <li className="analysis-more">{fillTemplate(labels.moreMembers, { n: total - MAX_LIST_ITEMS })}</li> : null;
  const goButton = (target: string, text: string): JSX.Element => (
    <button type="button" className="analysis-link" title={fillTemplate(l.goTo, { name: name.type(target) })} onClick={go(target)}>
      {text}
    </button>
  );
  const list = (items: JSX.Element[], total: number): JSX.Element =>
    total === 0 ? <p className="analysis-empty">{l.none}</p> : <ul className="analysis-list">{items}{more(total)}</ul>;

  const metricLabel: Record<HeatMetric, string> = {
    none: l.heatNone, fanIn: l.heatFanIn, fanOut: l.heatFanOut, instability: l.heatInstability,
  };
  const legend = overlay.legend;
  const fmt = (x: number): string => (legend?.metric === 'instability' ? fixed2(x) : String(x));

  const order = a.layers.order;
  const summary = fillTemplate(l.summary, { types: a.graph.nodes.length, deps: a.graph.edgeCount });

  return (
    <aside id={id} className="analysis-panel" role="region" aria-label={l.panelAria}>
      <div className="analysis-head">
        <h2>{l.panelAria}</h2>
        <button type="button" className="puml-viewer-reset" onClick={onClose}>{l.close}</button>
      </div>
      <p className="analysis-summary">{includeExternal ? summary : `${summary} ${l.excluded}`}</p>

      <div className="analysis-controls">
        <label className="analysis-field">
          {l.heatmap}
          <select value={metric} onChange={(e) => onMetricChange(e.target.value as HeatMetric)}>
            {METRICS.map((m) => <option key={m} value={m}>{metricLabel[m]}</option>)}
          </select>
        </label>
        {legend ? (
          <div
            className="analysis-legend"
            role="img"
            aria-label={fillTemplate(l.legendRange, { metric: metricLabel[legend.metric], min: fmt(legend.min), max: fmt(legend.max) })}
          >
            <span className="analysis-legend-value" aria-hidden="true">{fmt(legend.min)}</span>
            <span className="analysis-legend-ramp" aria-hidden="true">
              {Array.from({ length: HEAT_STEPS }, (_, i) => (
                <span key={i} className="analysis-legend-step" style={{ background: `var(--heat-${i + 1})` }} />
              ))}
            </span>
            <span className="analysis-legend-value" aria-hidden="true">{fmt(legend.max)}</span>
          </div>
        ) : null}
        <ul className="analysis-marks">
          <li>
            <svg width="28" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="28" y2="4" style={{ stroke: 'var(--mark-cycle)' }} strokeWidth="4" />
              <line x1="0" y1="4" x2="28" y2="4" style={{ stroke: 'var(--bg-elev)' }} strokeWidth="1.2" />
            </svg>
            {l.legendCycle}
          </li>
          <li>
            <svg width="28" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="28" y2="4" style={{ stroke: 'var(--mark-violation)' }} strokeWidth="2" strokeDasharray="9 3 2 3" />
            </svg>
            {l.legendViolation}
          </li>
        </ul>
        <label className="analysis-check">
          <input type="checkbox" checked={includeExternal} onChange={(e) => onIncludeExternalChange(e.target.checked)} />
          {l.includeExternal}
        </label>
      </div>

      <Section title={fillTemplate(l.cycles, { n: a.cycles.length })}>
        {list(
          a.cycles.slice(0, MAX_LIST_ITEMS).map((c) => (
            <li key={c.members[0]}>{goButton(c.members[0] as string, c.path.map((x) => name.type(x)).join(' → '))}</li>
          )),
          a.cycles.length,
        )}
      </Section>
      <Section title={fillTemplate(l.packageCycles, { n: a.packageCycles.length })}>
        {list(
          a.packageCycles.slice(0, MAX_LIST_ITEMS).map((c) => (
            <li key={c.members[0]} translate="no">{c.path.map((p) => name.pkg(p)).join(' → ')}</li>
          )),
          a.packageCycles.length,
        )}
      </Section>
      <Section title={fillTemplate(l.selfLoops, { n: a.selfLoops.length })}>
        {list(a.selfLoops.slice(0, MAX_LIST_ITEMS).map((x) => <li key={x}>{goButton(x, name.type(x))}</li>), a.selfLoops.length)}
      </Section>
      <Section title={fillTemplate(l.violations, { n: a.violations.length })}>
        {order.length === 0 ? (
          <p className="analysis-empty">{l.layersNone}</p>
        ) : (
          <>
            <p className="analysis-note">
              {fillTemplate(l.layersOrder, {
                source: a.layers.source === 'config' ? l.layersFromConfig : l.layersFromModel,
                layers: order.join(' → '),
              })}{' '}
              {l.layersRule}
            </p>
            {list(
              a.violations.slice(0, MAX_LIST_ITEMS).map((v) => (
                <li key={`${v.source}\u0001${v.target}`}>
                  {goButton(v.source, `${name.type(v.source)} (${order[v.sourceLayer]}) → ${name.type(v.target)} (${order[v.targetLayer]})`)}
                </li>
              )),
              a.violations.length,
            )}
          </>
        )}
      </Section>

      <Section title={l.metrics}>
        <h3>{l.byCategory}</h3>
        <dl className="analysis-dl">
          {CATEGORY_ORDER.filter((c) => (a.categories[c] ?? 0) > 0).map((c) => (
            <div key={c}>
              <dt>{l.categories[c]}</dt>
              <dd>{a.categories[c]}</dd>
            </div>
          ))}
        </dl>
        <h3>{l.inheritance}</h3>
        <p className="analysis-note">
          {fillTemplate(l.inheritanceDepth, { n: a.inheritance.depth })}
          {a.inheritance.depth > 0 ? ` (${a.inheritance.chain.map((x) => name.type(x)).join(' → ')})` : ''}
        </p>
        {a.topCoupled.length > 0 ? (
          <>
            <h3>{l.topCoupled}</h3>
            <table className="analysis-table">
              <thead>
                <tr><th scope="col">{l.colClass}</th><th scope="col">{l.colCaShort}</th><th scope="col">{l.colCeShort}</th><th scope="col">{l.colI}</th></tr>
              </thead>
              <tbody>
                {a.topCoupled.map((c) => (
                  <tr key={c.id}>
                    <th scope="row">{goButton(c.id, name.type(c.id))}</th>
                    <td>{c.ca}</td><td>{c.ce}</td><td>{fixed2(c.instability)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
        {a.packages.length > 0 ? (
          <>
            <h3>{l.packages}</h3>
            <table className="analysis-table">
              <thead>
                <tr>
                  <th scope="col">{l.colPackage}</th><th scope="col">{l.colI}</th><th scope="col">{l.colA}</th><th scope="col">{l.colD}</th>
                </tr>
              </thead>
              <tbody>
                {a.packages.slice(0, MAX_LIST_ITEMS).map((p) => (
                  <tr key={p.name}>
                    <th scope="row" translate="no" title={name.pkg(p.name)}>{name.pkg(p.name)}</th>
                    <td>{fixed2(p.instability)}</td><td>{fixed2(p.abstractness)}</td><td>{fixed2(p.distance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
        <p className="analysis-note">{l.legend}</p>
      </Section>

      <div className="analysis-actions">
        <button type="button" className="puml-viewer-reset" onClick={onExport} disabled={!onExport} title={l.exportTitle}>
          {l.exportReport}
        </button>
      </div>
    </aside>
  );
});
