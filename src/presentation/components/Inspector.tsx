import { useMemo, type JSX } from 'react';
import { classify } from '../../domain/diagram/classify';
import type { Category, DiagramModel, ParseIssue, RelType, RelationshipModel, TypeNode } from '../../domain/diagram/model';
import { useLocalization } from '../localization/LocalizationProvider';
import type { MessageKey } from '../localization/translations';
import { CATEGORY_LETTER, CATEGORY_ORDER, DEFAULT_PACKAGE } from './entityGroups';
import { CodeIcon, ErrorDotIcon, WarningIcon } from './Icons';

interface Props {
  model: DiagramModel | null;
  selectedId: string | null;
  /** Nombre del documento (cabecera sin selección). */
  docName: string;
  /** Problemas visibles (sin los ignorados). */
  issues: readonly ParseIssue[];
  /** El diagrama mostrado es el último válido (el código tiene errores). */
  stale: boolean;
  onSelect: (id: string) => void;
  /** "Ir al código" de la clase; sin él no se muestra. */
  onGoToType?: (id: string) => void;
  onIssue: (issue: ParseIssue) => void;
}

interface RelRow {
  key: string;
  label: string;
  other: TypeNode | null;
  otherId: string;
}

const OUT: Record<RelType, MessageKey> = {
  EXTENDS: 'inspector.rel.extends',
  IMPLEMENTS: 'inspector.rel.implements',
  ASSOCIATION: 'inspector.rel.association',
  DEPENDENCY: 'inspector.rel.dependency',
  AGGREGATION: 'inspector.rel.aggregation',
  COMPOSITION: 'inspector.rel.composition',
};
const IN: Record<RelType, MessageKey> = {
  EXTENDS: 'inspector.rel.extendedBy',
  IMPLEMENTS: 'inspector.rel.implementedBy',
  ASSOCIATION: 'inspector.rel.associatedFrom',
  DEPENDENCY: 'inspector.rel.usedBy',
  AGGREGATION: 'inspector.rel.partOf',
  COMPOSITION: 'inspector.rel.partOf',
};

function Glyph({ category }: { category: Category }): JSX.Element {
  return <span className={`glyph g-${category}`} aria-hidden="true">{CATEGORY_LETTER[category]}</span>;
}

/** Inspector de solo lectura (T11): resumen y problemas sin selección; ficha de la clase con selección. */
export function Inspector({ model, selectedId, docName, issues, stale, onSelect, onGoToType, onIssue }: Props): JSX.Element {
  const { t } = useLocalization();
  const byId = useMemo(() => new Map((model?.types ?? []).map((x) => [x.id, x])), [model]);
  const type = selectedId !== null ? byId.get(selectedId) ?? null : null;

  const issueButton = (issue: ParseIssue, i: number): JSX.Element => (
    <button key={`${issue.line}-${i}`} type="button" className="inspector-issue" onClick={() => onIssue(issue)}>
      <span className={issue.severity === 'error' ? 'sev-icon error' : 'sev-icon warning'} role="img" aria-label={t(issue.severity === 'error' ? 'issues.error' : 'issues.warning')}>
        {issue.severity === 'error' ? <ErrorDotIcon /> : <WarningIcon />}
      </span>
      <span>{t('inspector.lineMessage', { line: issue.line, message: issue.message })}</span>
    </button>
  );

  if (!model) {
    return (
      <aside className="inspector" aria-label={t('inspector.title')}>
        <div className="panel-head"><span className="panel-title">{t('inspector.title')}</span></div>
      </aside>
    );
  }

  if (!type) {
    const counts = new Map<Category, number>();
    for (const x of model.types) counts.set(classify(x), (counts.get(classify(x)) ?? 0) + 1);
    const packages = new Set(model.types.map((x) => x.packageName).filter((p) => p !== DEFAULT_PACKAGE)).size;
    return (
      <aside className="inspector" aria-label={t('inspector.title')}>
        <div className="panel-head"><span className="panel-title">{t('inspector.title')}</span></div>
        <div className="inspector-head">
          <h2 className="inspector-name">{docName}</h2>
          <p className="muted">{t('inspector.selectHint')}</p>
        </div>
        <section className="inspector-sec">
          <h3>{t('inspector.model')}</h3>
          <div className="inspector-counts">
            {CATEGORY_ORDER.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => {
              const n = counts.get(c) ?? 0;
              return (
                <span key={c} className="inspector-count">
                  <Glyph category={c} />
                  {t(`inspector.count.${c}.${n === 1 ? 'one' : 'other'}` as MessageKey, { n })}
                </span>
              );
            })}
          </div>
          <p className="muted inspector-note">{t('inspector.totals', { relations: model.relationships.length, packages })}</p>
        </section>
        <section className="inspector-sec">
          <h3>{t('inspector.problems', { n: issues.length })}</h3>
          {issues.length === 0 ? <p className="muted inspector-note">{t('inspector.noProblems')}</p> : issues.map(issueButton)}
        </section>
      </aside>
    );
  }

  const category = classify(type);
  const fields = [
    ...type.enumConstants.map((c, i) => ({ key: 'e' + i, vis: '', name: c, type: '' })),
    ...type.attributes.map((a, i) => ({ key: 'a' + i, vis: a.visibility, name: a.name, type: a.type })),
  ];
  const methods = [
    ...type.constructors.map((c, i) => ({ key: 'c' + i, text: `${c.visibility} «create» ${c.name}(${c.parameters.map((p) => (p.name ? `${p.name} : ${p.type}` : p.type)).join(', ')})` })),
    ...type.methods.map((m, i) => ({
      key: 'm' + i,
      text: `${m.visibility} ${m.name}(${m.parametersAbbreviated !== undefined ? '…' + m.parametersAbbreviated : m.parameters.map((p) => (p.name ? `${p.name} : ${p.type}` : p.type)).join(', ')})${m.returnType ? ' : ' + m.returnType : ''}`,
      italic: m.isAbstract,
    })),
  ];
  const rels: RelRow[] = [];
  let incoming = 0;
  model.relationships.forEach((r: RelationshipModel, i) => {
    if (r.source === type.id && r.target !== type.id) {
      const mult = r.targetLabel ? ' ' + r.targetLabel : '';
      rels.push({ key: 'o' + i, label: t(OUT[r.type]) + mult, other: byId.get(r.target) ?? null, otherId: r.target });
    } else if (r.target === type.id && r.source !== type.id) {
      incoming++;
      const mult = r.sourceLabel ? ' ' + r.sourceLabel : '';
      rels.push({ key: 'i' + i, label: t(IN[r.type]) + mult, other: byId.get(r.source) ?? null, otherId: r.source });
    }
  });
  const end = type.endLine ?? type.line;
  const own = issues.filter((x) => x.file === undefined && x.line >= type.line && x.line <= end);
  const kind = t(`inspector.kind.${category}` as MessageKey);
  const pkg = type.packageName === DEFAULT_PACKAGE ? t('sidebar.noPackage') : type.packageName;

  return (
    <aside className="inspector" aria-label={t('inspector.title')}>
      <div className="panel-head"><span className="panel-title">{t('inspector.title')}</span></div>
      <div className="inspector-head">
        <div className="inspector-title">
          <Glyph category={category} />
          <h2 className={type.isAbstract || category === 'abstract' ? 'inspector-name italic' : 'inspector-name'}>{type.name}</h2>
        </div>
        <p className="muted">{kind} · {pkg}</p>
        {onGoToType && (
          <button type="button" className="ghost-btn outline" onClick={() => onGoToType(type.id)}>
            <CodeIcon />
            {t('inspector.goToCode', { line: type.line })}
          </button>
        )}
        {stale && <p className="muted inspector-note">{t('inspector.stale')}</p>}
      </div>
      <section className="inspector-sec">
        <h3>{t(category === 'enum' ? 'inspector.values' : 'inspector.attributes', { n: fields.length })}</h3>
        {fields.length === 0 ? <p className="muted inspector-note">{t('inspector.none')}</p> : (
          <ul className="inspector-members">
            {fields.map((f) => (
              <li key={f.key}>
                {f.vis && <span className="muted">{f.vis}</span>}
                <span className="mem-name">{f.name}</span>
                {f.type && <span className="mem-type">{f.type}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {category !== 'enum' || methods.length > 0 ? (
        <section className="inspector-sec">
          <h3>{t('inspector.methods', { n: methods.length })}</h3>
          {methods.length === 0 ? <p className="muted inspector-note">{t('inspector.none')}</p> : (
            <ul className="inspector-members">
              {methods.map((m) => <li key={m.key} className={'italic' in m && m.italic ? 'italic' : undefined}>{m.text}</li>)}
            </ul>
          )}
        </section>
      ) : null}
      <section className="inspector-sec">
        <h3>{t('inspector.relations', { n: rels.length })}</h3>
        {rels.map((r) => (
          <button key={r.key} type="button" className="inspector-rel" onClick={() => onSelect(r.otherId)} disabled={!r.other}>
            <span className="rel-kind">{r.label}</span>
            {r.other && <Glyph category={classify(r.other)} />}
            <span className={r.other && (r.other.isAbstract || classify(r.other) === 'abstract') ? 'rel-name italic' : 'rel-name'}>{r.other?.name ?? r.otherId}</span>
          </button>
        ))}
        {incoming === 0 && <p className="muted inspector-note">{t('inspector.noDependents', { name: type.name })}</p>}
      </section>
      <section className="inspector-sec">
        <h3>{t('inspector.warnings')}</h3>
        {own.length === 0 ? <p className="muted inspector-note">{t('inspector.noWarnings')}</p> : own.map(issueButton)}
      </section>
    </aside>
  );
}
