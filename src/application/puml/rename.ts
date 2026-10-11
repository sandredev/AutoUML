// Reglas del renombrado de un tipo desde el lienzo (T7). Módulo puro: sin React, sin CodeMirror.
// La reescritura del texto vive en presentation/editor/rename.ts (necesita el tokenizador del editor).
import type { DiagramModel } from '../../domain/diagram/model';

export type RenameProblem = 'unchanged' | 'invalid' | 'duplicate' | 'unsupported';

const RE_IDENTIFIER = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;

/** null si `next` es un nombre válido para el tipo `id`; si no, el motivo. */
export function validateRename(model: DiagramModel, id: string, next: string): RenameProblem | null {
  const type = model.types.find((t) => t.id === id);
  // Con alias o genéricos el nombre visible no es el identificador: el renombrado en línea no aplica.
  if (!type || type.name !== type.id) return 'unsupported';
  if (next === id) return 'unchanged';
  if (!RE_IDENTIFIER.test(next)) return 'invalid';
  if (model.types.some((t) => t.id === next)) return 'duplicate';
  return null;
}
