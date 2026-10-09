// src/render/layout/elkEnv.ts — permite usar elkjs/lib/elk.bundled.js dentro de un Web Worker.
// elk.bundled.js decide su modo con `typeof document === 'undefined' && typeof self !== 'undefined'`
// la PRIMERA vez que se construye `new ELK()` (su motor interno se carga de forma perezosa):
// dentro de un Worker se registra como worker (toma self.onmessage) y NO exporta su motor,
// así que la construcción falla con "_Worker is not a constructor" y todo caía a dagre.
// Con un `document` temporal durante esa construcción, elkjs usa su motor en el mismo hilo.

/** Ejecuta `fn` con un `document` falso si no existe (y lo quita al terminar). */
export function withElkEnv<T>(fn: () => T): T {
  const g = globalThis as { document?: unknown };
  const shimmed = typeof g.document === 'undefined';
  if (shimmed) g.document = {};
  try {
    return fn();
  } finally {
    if (shimmed) delete g.document;
  }
}
