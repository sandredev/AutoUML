/** Retardo antes de mostrar la intro en cargas posteriores al arranque: si terminan antes, no aparece. */
export const INTRO_SHOW_DELAY_MS = 120;

/** Mínimo visible de la intro en el arranque, para que el acto de construcción del logo llegue a verse. */
export const INTRO_BOOT_MIN_MS = 1200;

/** Duración del fundido de salida. Debe coincidir con la transición CSS. */
export const INTRO_EXIT_MS = 200;

export interface IntroSignals {
  /** Arranque: hasta recibir la primera respuesta IPC. */
  booting: boolean;
  /** Lectura y parseo de un .puml en curso. */
  documentLoading: boolean;
  /** Cálculo de layout en el worker en curso. */
  layoutLoading: boolean;
}

/** La intro está activa mientras cualquier carga siga en curso. */
export function isIntroActive(signals: IntroSignals): boolean {
  return signals.booting || signals.documentLoading || signals.layoutLoading;
}
