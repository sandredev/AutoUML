// src/application/puml/validate.ts
import type { ParseIssue } from '../../domain/diagram/model';

/** Validaciones estructurales previas al parseo. */
export function validatePuml(source: string): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  if (text.trim().length === 0) {
    return [{ line: 1, severity: 'error', message: 'El archivo está vacío' }];
  }
  const lines = text.split(/\r\n|\r|\n/u);
  let start = -1;
  let end = -1;
  let nullReported = false;
  for (let i = 0; i < lines.length; i++) {
    const l = (lines[i] ?? '').trim();
    if (!nullReported && l.includes('\u0000')) {
      issues.push({ line: i + 1, severity: 'error', message: 'El archivo contiene bytes nulos (¿es binario?)' });
      nullReported = true;
    }
    if (start < 0 && /^@startuml\b/iu.test(l)) start = i;
    if (/^@enduml\b/iu.test(l)) end = i;
  }
  if (start < 0) issues.push({ line: 1, severity: 'error', message: 'Falta la directiva @startuml' });
  if (end < 0) issues.push({ line: lines.length, severity: 'error', message: 'Falta la directiva @enduml' });
  if (start >= 0 && end >= 0 && end < start) {
    issues.push({ line: end + 1, severity: 'error', message: '@enduml aparece antes de @startuml' });
  }
  return issues;
}
