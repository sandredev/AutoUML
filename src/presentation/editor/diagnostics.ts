// ParseIssue → diagnósticos del editor (T7): subrayado + tooltip en la línea del problema.
import type { Diagnostic } from '@codemirror/lint';
import type { Text } from '@codemirror/state';
import type { ParseIssue } from '../../domain/diagram/model';

/**
 * Diagnósticos de los issues que caen en el archivo abierto (sin `file` o con `file === entryFile`).
 * Las posiciones salen del documento del editor (un salto de línea = 1 carácter, también con CRLF).
 * Se descartan las líneas que ya no existen: el texto puede haber cambiado desde que se parseó.
 */
export function issuesToDiagnostics(doc: Text, issues: readonly ParseIssue[], entryFile: string | null): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const issue of issues) {
    if (issue.file !== undefined && issue.file !== entryFile) continue;
    if (issue.line < 1 || issue.line > doc.lines) continue;
    const line = doc.line(issue.line);
    const indent = line.text.length - line.text.trimStart().length;
    out.push({ from: line.from + indent, to: line.to, severity: issue.severity, message: issue.message });
  }
  return out;
}
