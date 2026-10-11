// src/presentation/diagram/presentation/views.ts — vistas del modo presentación (T10, puro).
// Validación tolerante: una vista rota se descarta sin tumbar las demás, y un opcional malo se
// descarta campo a campo (la validación vive en application: el sidecar también la usa).
import type { SidecarView } from '../../../application/ports/ipc';

export { validateViews } from '../../../application/deckViews';

export type DeckView = SidecarView;

const MAX_TITLE = 200;

/** Forma JSON estable: sin campos undefined ni referencias compartidas. */
export function serializeViews(views: readonly DeckView[]): DeckView[] {
  return views.map((d) => {
    const out: DeckView = { title: d.title, view: { scale: d.view.scale, tx: d.view.tx, ty: d.view.ty } };
    if (d.filters !== undefined) out.filters = structuredClone(d.filters);
    if (d.focusKey !== undefined) out.focusKey = d.focusKey;
    if (d.collapsed !== undefined) out.collapsed = [...d.collapsed];
    if (d.frame !== undefined) out.frame = { w: d.frame.w, h: d.frame.h };
    return out;
  });
}

export function addView(views: readonly DeckView[], view: DeckView): DeckView[] {
  return [...views, view];
}

export function removeView(views: readonly DeckView[], index: number): DeckView[] {
  return views.filter((_, i) => i !== index);
}

export function renameView(views: readonly DeckView[], index: number, title: string): DeckView[] {
  return views.map((v, i) => (i === index ? { ...v, title: title.slice(0, MAX_TITLE) } : v));
}

/** Mueve la vista `from` a la posición `to` (acotada a la lista). */
export function moveView(views: readonly DeckView[], from: number, to: number): DeckView[] {
  if (from < 0 || from >= views.length) return [...views];
  const out = [...views];
  const [v] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, v);
  return out;
}

/**
 * Cámara guardada en un lienzo `frame` aplicada a uno de tamaño `size`: conserva el punto del centro
 * (como el cambio de tamaño de la pantalla completa). Sin frame (vistas antiguas) no la toca.
 */
export function recenterView<V extends { tx: number; ty: number }>(
  view: V,
  frame: { w: number; h: number } | undefined,
  size: { w: number; h: number },
): V {
  if (!frame || (frame.w === size.w && frame.h === size.h)) return { ...view };
  return { ...view, tx: view.tx + (size.w - frame.w) / 2, ty: view.ty + (size.h - frame.h) / 2 };
}

/** Índice tras pulsar ←/→ (sin dar la vuelta); -1 si no hay vistas. */
export function stepView(index: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  return Math.max(0, Math.min(count - 1, index + dir));
}
