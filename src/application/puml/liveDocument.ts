// Documento en vivo del editor (T7). Módulo puro: sin React, sin DOM, sin E/S.
// Reúne lo que comparten la carga desde disco y la edición: parsear el texto combinado,
// decidir qué diagrama se muestra mientras hay errores y qué hacer si el archivo cambia en disco.
import type { DiagramModel, ParseIssue } from '../../domain/diagram/model';
import type { PumlLineRef, PumlLoadIssue } from '../ports/ipc';
import { parsePuml } from './parser';

/** Resultado de resolver los !include: sin él, el texto no tiene incluidos. */
export interface CombineInfo {
  lineMap: readonly PumlLineRef[];
  loadIssues: readonly PumlLoadIssue[];
}

/**
 * Parsea el texto combinado. Los issues del parser van en líneas del combinado: se remapean al origen
 * (file + line) y guardan la línea combinada para el snippet. Los de la carga ya traen su origen.
 */
export function parseDocument(combined: string, info?: CombineInfo): DiagramModel {
  const model = parsePuml(combined);
  if (!info) return model;
  const remapped = model.issues.map((issue): ParseIssue => {
    const ref = info.lineMap[issue.line - 1];
    if (!ref) return issue;
    return { ...issue, file: ref.file, line: ref.line, combinedLine: issue.line };
  });
  const loaderIssues = info.loadIssues.map((i): ParseIssue => ({ line: i.line, severity: i.severity, message: i.message, file: i.file }));
  return { ...model, issues: [...loaderIssues, ...remapped] };
}

/** Un error (llave o nota sin cerrar, "}" suelta, ciclo de !include) deja el modelo a medias. */
export function hasBlockingErrors(model: DiagramModel): boolean {
  return model.issues.some((i) => i.severity === 'error');
}

export interface LiveState {
  /** Modelo que se dibuja. */
  shown: DiagramModel;
  /** Issues del último texto parseado (aunque no sea el que se dibuja). */
  issues: ParseIssue[];
  /** true si se dibuja un modelo anterior porque el texto actual tiene errores graves. */
  stale: boolean;
}

/**
 * Siguiente estado tras parsear un texto nuevo. Con errores graves se sigue mostrando el último
 * diagrama válido (no salta a medio escribir "class A {"); el panel de issues enseña los errores.
 */
export function nextLiveState(prev: LiveState | null, parsed: DiagramModel): LiveState {
  if (prev !== null && hasBlockingErrors(parsed)) {
    return { shown: prev.shown, issues: parsed.issues, stale: true };
  }
  return { shown: parsed, issues: parsed.issues, stale: false };
}

/**
 * El archivo cambió en disco mientras está abierto en el editor.
 * - 'in-sync': el disco ya tiene lo que muestra el editor (p. ej. el eco de nuestro guardado).
 * - 'replace': no hay cambios sin guardar; el editor toma el texto del disco.
 * - 'conflict': hay cambios sin guardar; no se pisan (el usuario decide al guardar).
 */
export function reconcileDiskText(s: { editorText: string; savedText: string; diskText: string }): 'in-sync' | 'replace' | 'conflict' {
  if (s.diskText === s.editorText) return 'in-sync';
  if (s.editorText === s.savedText) return 'replace';
  return 'conflict';
}
