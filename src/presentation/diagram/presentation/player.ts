// src/presentation/diagram/presentation/player.ts — recorrido de presentación de las vistas guardadas (T10.4, puro).
// El estado es solo "qué vista y si está activo"; la lista vive en el visor, y la cámara y la pantalla
// completa son efectos del que lo usa (la animación de cámara es la de tween.ts).
import { stepView } from './views';

export interface PlayerState {
  index: number;
  active: boolean;
}

/** `count`: cuántas vistas hay ahora mismo (la lista se edita desde el panel durante el recorrido). */
export type PlayerEvent = { type: 'next' | 'prev'; count: number } | { type: 'exit' };

export const clampIndex = (index: number, count: number): number => Math.max(0, Math.min(count - 1, index));

export function startPresentation(count: number, from = 0): PlayerState {
  return { index: clampIndex(from, count), active: count > 0 };
}

export function presentationReducer(state: PlayerState, event: PlayerEvent): PlayerState {
  if (event.type === 'exit') return { ...state, active: false };
  return { ...state, index: Math.max(0, stepView(state.index, event.count, event.type === 'next' ? 1 : -1)) };
}

/** Con `prefers-reduced-motion` se salta directo a la vista; si no, el vuelo de cámara de siempre. */
export const animatesTransition = (reducedMotion: boolean): boolean => !reducedMotion;
