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

/** Índice tras pulsar ←/→ (sin dar la vuelta); -1 si no hay vistas. */
export function stepView(index: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  return Math.max(0, Math.min(count - 1, index + dir));
}
