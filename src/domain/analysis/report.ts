// src/domain/analysis/report.ts — informe Markdown del diagnóstico de arquitectura (T9). Puro y determinista:
// mismo modelo ⇒ mismo texto (todo va ordenado por id/nombre, sin fechas, cifras con 2 decimales y punto).
// Los textos llegan traducidos en `ReportLabels` (el panel usa los mismos, así que informe y panel coinciden).
import type { Category, DiagramModel } from '../diagram/model';
import type { DiagramAnalysis } from './analyze';

export interface ReportLabels {
  /** "{title}: diagnóstico de arquitectura" */
  title: string;
  /** "{types} tipos analizados · {deps} dependencias." */
  summary: string;
  excluded: string;
  /** "Ciclos entre clases ({n})" */
  cycles: string;
  packageCycles: string;
  selfLoops: string;
  /** "{n} clases: {names}" (cuando el camino representativo no recorre todo el componente) */
  cycleMembers: string;
  none: string;
  /** "Violaciones de capas ({n})" */
  violations: string;
  /** "Capas de arriba abajo ({source}): {layers}." */
  layersOrder: string;
  layersFromConfig: string;
  layersFromModel: string;
  layersNone: string;
  layersRule: string;
  colSource: string;
  colTarget: string;
  colLayer: string;
  metrics: string;
  byCategory: string;
  colCategory: string;
  colTypes: string;
  inheritance: string;
  /** "Profundidad máxima: {n}" */
  inheritanceDepth: string;
  topCoupled: string;
  colClass: string;
  colCa: string;
  colCe: string;
  /** Cabeceras cortas de la tabla de paquetes. */
  colCaShort: string;
  colCeShort: string;
  colI: string;
  packages: string;
  colPackage: string;
  colAbstract: string;
  colA: string;
  colD: string;
  legend: string;
  noPackage: string;
  categories: Record<Category, string>;
}

export const CATEGORY_ORDER: readonly Category[] = [
  'sealed', 'abstract', 'interface', 'enum', 'record', 'annotation', 'class', 'external', 'undeclared',
];
const DEFAULT_PACKAGE = '(default package)';

export function fillTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Cifra con 2 decimales, independiente del idioma del sistema. */
export const fixed2 = (x: number): string => x.toFixed(2);

/** Texto seguro dentro de una celda o línea Markdown. */
function md(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Nombre visible de un tipo (o el id si no existe) y de un paquete. */
export function namers(model: DiagramModel, l: Pick<ReportLabels, 'noPackage'>): {
  type: (id: string) => string;
  pkg: (name: string) => string;
} {
  const names = new Map(model.types.map((t) => [t.id, t.name]));
  return {
    type: (id) => names.get(id) ?? id,
    pkg: (name) => (name === DEFAULT_PACKAGE ? l.noPackage : name),
  };
}

function table(head: string[], align: Array<'l' | 'r'>, rows: string[][]): string {
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  return [line(head), line(align.map((a) => (a === 'r' ? '---:' : '---'))), ...rows.map(line)].join('\n');
}

export function analysisReport(model: DiagramModel, a: DiagramAnalysis, l: ReportLabels, title: string, opts: { includeExternal?: boolean } = {}): string {
  const name = namers(model, l);
  const out: string[] = [];
  const section = (heading: string, body: string): void => {
    out.push(`## ${heading}`, body);
  };
  const list = (items: string[]): string => (items.length === 0 ? l.none : items.map((s) => `- ${s}`).join('\n'));

  out.push(`# ${md(fillTemplate(l.title, { title }))}`);
  const summary = fillTemplate(l.summary, { types: a.graph.nodes.length, deps: a.graph.edgeCount });
  out.push(opts.includeExternal ? summary : `${summary} ${l.excluded}`);

  const cycleLine = (path: string[], members: string[], nameOf: (id: string) => string): string => {
    const text = path.map((id) => md(nameOf(id))).join(' → ');
    return members.length > path.length - 1
      ? `${text} (${fillTemplate(l.cycleMembers, { n: members.length, names: members.map((id) => md(nameOf(id))).join(', ') })})`
      : text;
  };
  section(fillTemplate(l.cycles, { n: a.cycles.length }), list(a.cycles.map((c) => cycleLine(c.path, c.members, name.type))));
  section(fillTemplate(l.packageCycles, { n: a.packageCycles.length }), list(a.packageCycles.map((c) => cycleLine(c.path, c.members, name.pkg))));
  section(fillTemplate(l.selfLoops, { n: a.selfLoops.length }), list(a.selfLoops.map((id) => md(name.type(id)))));

  const order = a.layers.order;
  let layersBody: string;
  if (order.length === 0) {
    layersBody = l.layersNone;
  } else {
    const intro = `${fillTemplate(l.layersOrder, {
      source: a.layers.source === 'config' ? l.layersFromConfig : l.layersFromModel,
      layers: order.map(md).join(' → '),
    })} ${l.layersRule}`;
    layersBody = a.violations.length === 0
      ? `${intro}\n\n${l.none}`
      : `${intro}\n\n${table(
        [l.colSource, l.colLayer, l.colTarget, l.colLayer],
        ['l', 'l', 'l', 'l'],
        a.violations.map((v) => [md(name.type(v.source)), md(order[v.sourceLayer] ?? ''), md(name.type(v.target)), md(order[v.targetLayer] ?? '')]),
      )}`;
  }
  section(fillTemplate(l.violations, { n: a.violations.length }), layersBody);

  out.push(`## ${l.metrics}`);
  out.push(`### ${l.byCategory}`, table(
    [l.colCategory, l.colTypes],
    ['l', 'r'],
    CATEGORY_ORDER.filter((c) => (a.categories[c] ?? 0) > 0).map((c) => [md(l.categories[c]), String(a.categories[c])]),
  ));
  const depth = fillTemplate(l.inheritanceDepth, { n: a.inheritance.depth });
  out.push(`### ${l.inheritance}`, a.inheritance.depth > 0 ? `${depth} (${a.inheritance.chain.map((id) => md(name.type(id))).join(' → ')})` : depth);
  if (a.topCoupled.length > 0) {
    out.push(`### ${l.topCoupled}`, table(
      [l.colClass, l.colCa, l.colCe, l.colI],
      ['l', 'r', 'r', 'r'],
      a.topCoupled.map((c) => [md(name.type(c.id)), String(c.ca), String(c.ce), fixed2(c.instability)]),
    ));
  }
  if (a.packages.length > 0) {
    const rows = a.packages
      .map((p) => ({ p, label: name.pkg(p.name) }))
      .sort((x, y) => (x.label < y.label ? -1 : x.label > y.label ? 1 : 0))
      .map(({ p, label }) => [
        md(label), String(p.types), String(p.abstractTypes), String(p.ca), String(p.ce),
        fixed2(p.instability), fixed2(p.abstractness), fixed2(p.distance),
      ]);
    out.push(`### ${l.packages}`, table(
      [l.colPackage, l.colTypes, l.colAbstract, l.colCaShort, l.colCeShort, l.colI, l.colA, l.colD],
      ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
      rows,
    ));
  }
  out.push(l.legend);
  return `${out.join('\n\n')}\n`;
}
