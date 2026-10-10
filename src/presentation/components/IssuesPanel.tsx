import type { JSX } from 'react';
import type { ParseIssue } from '../../domain/diagram/model';
import { useLocalization } from '../localization/LocalizationProvider';

interface Props {
  issues: ParseIssue[];
  source: string | null;
  open: boolean;
  onToggle: () => void;
}

/** Texto de la línea indicada (1-based), o cadena vacía si no existe. */
function lineAt(source: string | null, line: number): string {
  if (!source) return '';
  const lines = source.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  return lines[line - 1] ?? '';
}

export function IssuesPanel({ issues, source, open, onToggle }: Props): JSX.Element | null {
  const { t } = useLocalization();
  if (issues.length === 0) return null;

  const errors = issues.filter((i) => i.severity === 'error').length;

  return (
    <section className={`issues-panel${open ? ' open' : ''}`} aria-label={t('issues.title')}>
      <button type="button" className="issues-header" aria-expanded={open} onClick={onToggle}>
        <span>{t('issues.count', { count: issues.length })}</span>
        {errors > 0 && <span className="issues-errors">{t('issues.errors', { count: errors })}</span>}
        <span className="issues-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <ul className="issues-list">
          {issues.map((issue, idx) => {
            // El snippet sale del texto combinado (misma numeración que combinedLine);
            // L{line} + archivo son el origen real (tras !include).
            const text = lineAt(source, issue.combinedLine ?? issue.line);
            const base = issue.file?.split(/[/\\]/).pop();
            return (
              <li key={`${issue.line}-${idx}`} className={`issue ${issue.severity}`}>
                <span className="issue-line">L{issue.line}</span>
                {base && <span className="issue-file">{base}</span>}
                <span className={`issue-sev ${issue.severity}`}>{issue.severity === 'error' ? t('issues.error') : t('issues.warning')}</span>
                <span className="issue-msg">{issue.message}</span>
                {text.trim().length > 0 && (
                  <code className="issue-src" title={text}>
                    {text.trim()}
                  </code>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
