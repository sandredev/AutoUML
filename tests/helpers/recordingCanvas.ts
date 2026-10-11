// tests/helpers/recordingCanvas.ts — CanvasRenderingContext2D falso que graba cada llamada y cada asignación.
// Sirve para comparar dos dibujos (mismo registro ⇒ mismo resultado) sin DOM ni canvas real.

export interface RecordingCanvas {
  ctx: CanvasRenderingContext2D;
  log: string[];
}

export function recordingCanvas(): RecordingCanvas {
  const log: string[] = [];
  const props = new Map<PropertyKey, unknown>([
    ['fillStyle', '#000000'],
    ['strokeStyle', '#000000'],
    ['font', '10px sans-serif'],
    ['globalAlpha', 1],
    ['lineWidth', 1],
  ]);
  const fmt = (v: unknown): string => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : JSON.stringify(v));
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, key) {
      if (props.has(key)) return props.get(key);
      if (key === 'measureText') return (text: string) => ({ width: text.length * 7 });
      if (key === 'getLineDash') return () => [];
      return (...args: unknown[]) => {
        log.push(`${String(key)}(${args.map(fmt).join(',')})`);
        return undefined;
      };
    },
    set(_t, key, value) {
      props.set(key, value);
      log.push(`${String(key)}=${fmt(value)}`);
      return true;
    },
  });
  return { ctx, log };
}
