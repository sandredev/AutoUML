// Vigilancia de archivos .puml con debounce coalescado.
// Módulo de main sin Electron: el watcher se inyecta (por defecto fs.watch),
// así los tests usan un emisor de mentira y el main el fs real.
import fs from 'node:fs';

export interface WatchEvent {
  kind: 'changed' | 'removed';
  path: string;
}

type WatchFn = (path: string, listener: (type: string) => void) => { close(): void };

/** Comprueba si la ruta sigue en disco (rename sin archivo = borrado). */
function stillExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export class WatchManager {
  private readonly watchers = new Map<string, { close(): void }>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly debounceMs = 300,
    private readonly watchFn: WatchFn = (p, l) => fs.watch(p, l),
  ) {}

  /** Vigila la lista (reemplaza la anterior); devuelve las vigiladas. */
  watch(files: readonly string[], onEvent: (e: WatchEvent) => void): { watched: string[] } {
    this.unwatchAll();
    const watched: string[] = [];
    const seen = new Set<string>();
    for (const f of files) {
      if (typeof f !== 'string' || f.trim() === '' || seen.has(f)) continue;
      seen.add(f);
      try {
        this.watchers.set(f, this.watchFn(f, (t) => this.onRaw(f, t, onEvent)));
        watched.push(f);
      } catch {
        // Si un archivo no se puede vigilar, se ignora sin tumbar al resto.
      }
    }
    return { watched };
  }

  /** Cierra todos los watchers y cancela los debounces pendientes. */
  unwatchAll(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const w of this.watchers.values()) {
      try {
        w.close();
      } catch {
        // Cierre best-effort: un watcher roto no bloquea al resto.
      }
    }
    this.watchers.clear();
  }

  private onRaw(p: string, type: string, onEvent: (e: WatchEvent) => void): void {
    if (type === 'rename' && !stillExists(p)) {
      // Borrado o renombrado: se suelta el watcher y se avisa una vez.
      const pending = this.timers.get(p);
      if (pending !== undefined) {
        clearTimeout(pending);
        this.timers.delete(p);
      }
      const w = this.watchers.get(p);
      if (w !== undefined) {
        try {
          w.close();
        } catch {
          // Cierre best-effort.
        }
        this.watchers.delete(p);
      }
      onEvent({ kind: 'removed', path: p });
      return;
    }
    // Resto (change, o rename con archivo): debounce coalescado por ruta.
    const prev = this.timers.get(p);
    if (prev !== undefined) clearTimeout(prev);
    this.timers.set(
      p,
      setTimeout(() => {
        this.timers.delete(p);
        if (this.watchers.has(p)) onEvent({ kind: 'changed', path: p });
      }, this.debounceMs),
    );
  }
}
