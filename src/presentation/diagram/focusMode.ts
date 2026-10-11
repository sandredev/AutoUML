// src/presentation/diagram/focusMode.ts — modo foco del visor: qué id se enfoca y qué teclas atiende (puro, T8).
import type { DiagramModel } from '../../domain/diagram/model';
import { collapsedOwner, PACKAGE_NODE_PREFIX } from './layout/aggregate';

/**
 * Id que se enfoca con la selección actual dentro del modelo agregado (`focusable`). Una clase escondida
 * en un paquete plegado enfoca ese paquete: el foco trabaja con lo que se ve. null si no hay nada que enfocar.
 */
export function focusTargetOf(
  selectedId: string | null,
  focusable: DiagramModel,
  source: DiagramModel,
  collapsed: ReadonlySet<string>,
): string | null {
  if (selectedId === null) return null;
  if (focusable.types.some((t) => t.id === selectedId)) return selectedId;
  const pkg = source.types.find((t) => t.id === selectedId)?.packageName;
  const owner = pkg !== undefined ? collapsedOwner(pkg, collapsed) : null;
  if (owner === null) return null;
  const id = PACKAGE_NODE_PREFIX + owner;
  return focusable.types.some((t) => t.id === id) ? id : null;
}

/**
 * Qué hace F: sin foco, entrar en el de la selección (`target`); en foco (`current`), cambiar a otra
 * selección o, si es la misma o no hay, salir. null si no hay nada que hacer.
 */
export function focusToggle(current: string | null, target: string | null): 'enter' | 'exit' | null {
  if (current !== null) return target !== null && target !== current ? 'enter' : 'exit';
  return target !== null ? 'enter' : null;
}

export type ViewerShortcut = 'toggle-focus' | 'escape' | 'back';

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  target: unknown;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** ¿El destino de la tecla es un campo de texto, desplegable o editor? Ahí las teclas son suyas. */
export function isEditable(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  return el.isContentEditable === true || (typeof el.tagName === 'string' && EDITABLE_TAGS.has(el.tagName));
}

/** Atajo del visor de una pulsación, o null (con modificadores, escribiendo en un campo/editor o ya atendida). */
export function viewerShortcut(e: KeyLike): ViewerShortcut | null {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return null;
  // Esc y Retroceso también valen con el foco en un desplegable (profundidad/dirección del foco).
  const onSelect = (e.target as { tagName?: unknown } | null)?.tagName === 'SELECT';
  if (onSelect && e.key === 'Escape') return 'escape';
  if (onSelect && e.key === 'Backspace') return 'back';
  if (isEditable(e.target)) return null;
  if (e.key === 'f' || e.key === 'F') return 'toggle-focus';
  // Enter alterna el foco solo desde el canvas: en un botón o enlace activa el control.
  if (e.key === 'Enter' && (e.target as { tagName?: unknown }).tagName === 'CANVAS') return 'toggle-focus';
  // Esc deshace por capas y, como última, sale de pantalla completa; Retroceso es lo mismo sin esa última.
  if (e.key === 'Escape') return 'escape';
  if (e.key === 'Backspace') return 'back';
  return null;
}
