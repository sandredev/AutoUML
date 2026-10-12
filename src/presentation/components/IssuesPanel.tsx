import type { JSX } from 'react';
import type { ParseIssue } from '../../domain/diagram/model';
import { useLocalization } from '../localization/LocalizationProvider';
import { ChevronDownIcon, ChevronRightIcon, ErrorDotIcon, WarningIcon } from './Icons';
import { canIgnore } from './issueKeys';

interface Props {
  /** Problemas visibles (sin ignorados), errores primero. */
  issues: readonly ParseIssue[];
  /** Avisos ignorados en este documento (se pueden volver a mostrar). */
  ignored: number;
  open: boolean;
  onToggle: () => void;
  /** Clic en un problema: el editor salta a su línea. Sin él la lista no es interactiva. */
  onSelect?: (issue: ParseIssue) => void;
  /** "Ignorar en este archivo" (solo avisos). */
  onIgnore?: (issue: ParseIssue) => void;
  onRestoreIgnored?: () => void;
  /** Nombre del documento, para el title de Ignorar. */
  docName: string;
}

/**
 * Barra de Problemas (T11): plegada muestra el problema más grave en una línea; desplegada, la lista. No se
 * abre sola (tampoco al escribir): el usuario decide.
 */
export function IssuesPanel({ issues, ignored, open, onToggle, onSelect, onIgnore, onRestoreIgnored, docName }: Props): JSX.Element | null {
  const { t } = useLocalization();
  if (issues.length === 0 && ignored === 0) return null;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  const first = issues[0];

  const icon = (issue: ParseIssue): JSX.Element => (
    <span
      className={issue.severity === 'error' ? 'sev-icon error' : 'sev-icon warning'}
      role="img"
      aria-label={issue.severity === 'error' ? t('issues.error') : t('issues.warning')}
    >
      {issue.severity === 'error' ? <ErrorDotIcon /> : <WarningIcon />}
    </span>
  );
  const ignoreButton = (issue: ParseIssue, short: boolean): JSX.Element | null =>
    onIgnore && canIgnore(issue) ? (
      <button type="button" className="ghost-btn subtle" title={t('issues.ignoreTitle', { name: docName })} onClick={() => onIgnore(issue)}>
        {short ? t('issues.ignoreShort') : t('issues.ignore')}
      </button>
    ) : null;
  const summary = [
    errors > 0 ? t(errors === 1 ? 'issues.errorsOne' : 'issues.errorsOther', { count: errors }) : null,
    warnings > 0 ? t(warnings === 1 ? 'issues.warningsOne' : 'issues.warningsOther', { count: warnings }) : null,
  ].filter(Boolean).join(' · ');

  return (
    <section className={`issues-panel${open ? ' open' : ''}`} aria-label={t('issues.title')}>
      <div className="issues-head">
        <button type="button" className="issues-toggle" aria-expanded={open} onClick={onToggle}>
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
          <span className="issues-title">{t('issues.title')}</span>
          {open || !first ? (
            <span className="issues-summary">{summary || t('issues.none')}</span>
          ) : (
            <>
              {icon(first)}
              <span className="issues-first">{t('inspector.lineMessage', { line: first.line, message: first.message })}</span>
              {issues.length > 1 && <span className="issues-more">{t('issues.andMore', { count: issues.length - 1 })}</span>}
            </>
          )}
        </button>
        {!open && first ? ignoreButton(first, false) : null}
      </div>
      {open && (
        <ul className="issues-list">
          {issues.map((issue, idx) => {
            const base = issue.file?.split(/[/\\]/).pop();
            const content = (
              <>
                {icon(issue)}
                <span className="issue-line">L{issue.line}</span>
                {base && <span className="issue-file">{base}</span>}
                <span className="issue-msg">{issue.message}</span>
              </>
            );
            return (
              <li key={`${issue.line}-${idx}`} className={`issue ${issue.severity}`}>
                {onSelect ? (
                  <button type="button" className="issue-btn" title={t('issues.goTo', { line: issue.line })} onClick={() => onSelect(issue)}>
                    {content}
                  </button>
                ) : (
                  <span className="issue-btn">{content}</span>
                )}
                {ignoreButton(issue, true)}
              </li>
            );
          })}
          {ignored > 0 && (
            <li className="issue ignored">
              <span className="muted">{t(ignored === 1 ? 'issues.ignoredOne' : 'issues.ignoredOther', { count: ignored })}</span>
              {onRestoreIgnored && (
                <button type="button" className="ghost-btn subtle" onClick={onRestoreIgnored}>{t('issues.restoreIgnored')}</button>
              )}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
