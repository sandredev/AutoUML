// Debounce del parseo en vivo (T7): escribir no recalcula el diagrama en cada tecla.

/** Espera desde la última tecla antes de parsear y actualizar el diagrama. */
export const LIVE_PARSE_DELAY_MS = 250;

export interface Debouncer<T> {
  /** Programa `fn(value)`; una llamada nueva antes de que venza sustituye a la anterior. */
  schedule(value: T): void;
  /** Ejecuta ya lo pendiente (p. ej. al guardar). Sin nada pendiente no hace nada. */
  flush(): void;
  /** Descarta lo pendiente. */
  cancel(): void;
  pending(): boolean;
}

export function createDebouncer<T>(fn: (value: T) => void, delayMs: number): Debouncer<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: { value: T } | null = null;

  const run = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const job = last;
    last = null;
    if (job) fn(job.value);
  };

  return {
    schedule(value) {
      last = { value };
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(run, delayMs);
    },
    flush: run,
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      last = null;
    },
    pending: () => last !== null,
  };
}
