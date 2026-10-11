// src/presentation/diagram/presentation/player.ts — recorrido de presentación de las vistas guardadas (T10.4, puro).
// El estado es solo "qué vista y si está activo"; la cámara y la pantalla completa son efectos del que lo usa.
import { EASE_IN_OUT, VIEW_MS } from '../canvas/tween';
import { moveView, removeView, renameView, stepView, type DeckView } from './views';

export interface PlayerState {
  views: readonly DeckView[];
  index: number;
  active: boolean;
}

export type PlayerEvent =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'exit' }
  | { type: 'rename'; index: number; title: string }
  | { type: 'move'; from: number; to: number }
  | { type: 'remove'; index: number };

export function startPresentation(views: readonly DeckView[], from = 0): PlayerState {
  const index = Math.max(0, Math.min(views.length - 1, from));
  return { views, index: Math.max(0, index), active: views.length > 0 };
}

export function presentationReducer(state: PlayerState, event: PlayerEvent): PlayerState {
  const { views, index } = state;
  switch (event.type) {
    case 'next':
    case 'prev':
      return { ...state, index: Math.max(0, stepView(index, views.length, event.type === 'next' ? 1 : -1)) };
    case 'exit':
      return { ...state, active: false };
    case 'rename':
      return { ...state, views: renameView(views, event.index, event.title) };
    case 'move': {
      if (event.from < 0 || event.from >= views.length) return state;
      const to = Math.max(0, Math.min(views.length - 1, event.to));
      // La vista que se está viendo sigue siendo la misma aunque cambie de posición.
      let next = index;
      if (index === event.from) next = to;
      else if (event.from < index && to >= index) next = index - 1;
      else if (event.from > index && to <= index) next = index + 1;
      return { ...state, views: moveView(views, event.from, to), index: next };
    }
    case 'remove': {
      if (event.index < 0 || event.index >= views.length) return state;
      const nextViews = removeView(views, event.index);
      if (nextViews.length === 0) return { views: nextViews, index: 0, active: false };
      const next = event.index < index ? index - 1 : Math.min(index, nextViews.length - 1);
      return { ...state, views: nextViews, index: next };
    }
  }
}

export interface TransitionPlan {
  animate: boolean;
  durationMs: number;
  ease?: (t: number) => number;
}

/** Con `prefers-reduced-motion` se salta directo a la vista; si no, el vuelo de cámara de siempre. */
export function transitionPlan(reducedMotion: boolean): TransitionPlan {
  if (reducedMotion) return { animate: false, durationMs: 0 };
  return { animate: true, durationMs: VIEW_MS, ease: EASE_IN_OUT };
}
