// src/render/viewOptions.ts — opciones de vista del diagrama y "Restablecer" (puro, sin React).
import type { LayoutOptions } from './types';

/** Valores por defecto del layout (iguales a los de elkLayout.ts y layout.ts). */
export const DEFAULT_VIEW_OPTIONS: Readonly<Required<Pick<LayoutOptions, 'rankSep' | 'nodeSep'>>> = Object.freeze({
  rankSep: 80,
  nodeSep: 40,
});

export interface ViewOptionsState {
  options: LayoutOptions;
  /**
   * Se incrementa para forzar un recálculo del layout aunque el modelo y las opciones no cambien
   * (por ejemplo, al pulsar "Restablecer").
   */
  layoutVersion: number;
}

export function initialViewOptions(): ViewOptionsState {
  return { options: { ...DEFAULT_VIEW_OPTIONS }, layoutVersion: 0 };
}

/** Opciones por defecto + nueva versión de layout (fuerza el recálculo). */
export function resetViewOptions(state: ViewOptionsState): ViewOptionsState {
  return { options: { ...DEFAULT_VIEW_OPTIONS }, layoutVersion: state.layoutVersion + 1 };
}
