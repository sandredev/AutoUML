// src/presentation/components/issueKeys.ts — avisos ignorados por documento (puro, T11).
import type { ParseIssue } from '../../domain/diagram/model';

/**
 * Clave estable de un aviso: severidad, archivo de origen (nombre) y mensaje, SIN la línea. Así un aviso
 * ignorado sigue ignorado aunque se editen las líneas de alrededor. Los errores nunca se ignoran.
 */
export function issueKey(issue: ParseIssue): string {
  const file = issue.file ? issue.file.split(/[/\\]/u).pop() + ':' : '';
  return `${issue.severity}:${file}${issue.message}`;
}

/** Se puede ignorar: solo los avisos (un error impide dibujar, no se esconde). */
export function canIgnore(issue: ParseIssue): boolean {
  return issue.severity === 'warning';
}

/** Problemas a mostrar: sin los avisos ignorados y con los errores primero (luego por línea). */
export function visibleIssues(issues: readonly ParseIssue[], ignored: ReadonlySet<string>): ParseIssue[] {
  return issues
    .filter((i) => !(canIgnore(i) && ignored.has(issueKey(i))))
    .sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error') || a.line - b.line);
}

/** Cuántos de los problemas actuales están ignorados. */
export function ignoredCount(issues: readonly ParseIssue[], ignored: ReadonlySet<string>): number {
  return issues.filter((i) => canIgnore(i) && ignored.has(issueKey(i))).length;
}
