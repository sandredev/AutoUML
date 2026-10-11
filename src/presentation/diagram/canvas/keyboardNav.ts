// src/presentation/diagram/canvas/keyboardNav.ts — atajos de teclado del canvas (T10.6, puro).
import type { Adjacency } from '../graph/adjacency';

export type NavDir = 'next' | 'prev';
export type ShortcutAction = NavDir | 'focus' | 'zoomIn' | 'zoomOut' | 'fit' | 'help';

const KEYS: Readonly<Record<string, ShortcutAction>> = {
  ArrowRight: 'next',
  ArrowDown: 'next',
  ArrowLeft: 'prev',
  ArrowUp: 'prev',
  Enter: 'focus',
  '+': 'zoomIn',
  '=': 'zoomIn',
  '-': 'zoomOut',
  '_': 'zoomOut',
  '0': 'fit',
  '?': 'help',
};

/** Acción de una tecla; null si no es atajo o lleva Ctrl/Alt/Meta (no pisa los del navegador). */
export function shortcutOf(key: string, mods: { ctrl?: boolean; alt?: boolean; meta?: boolean } = {}): ShortcutAction | null {
  if (mods.ctrl || mods.alt || mods.meta) return null;
  return KEYS[key] ?? null;
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Siguiente clase al recorrer las conectadas de `from` (entrantes + salientes, orden por id, cíclico).
 * `current` es el último vecino visitado (null = empezar). Sin `from` recorre todos los nodos por id.
 * null si no hay a dónde ir.
 */
export function nextConnected(adj: Adjacency, from: string | null, dir: NavDir, current: string | null): string | null {
  const list =
    from === null
      ? [...adj.nodes].sort(byId)
      : [...new Set([...(adj.out.get(from) ?? []), ...(adj.in.get(from) ?? [])])].sort(byId);
  if (list.length === 0) return null;
  const i = current === null ? -1 : list.indexOf(current);
  if (i < 0) return dir === 'next' ? list[0] : list[list.length - 1];
  return list[(i + (dir === 'next' ? 1 : list.length - 1)) % list.length];
}
