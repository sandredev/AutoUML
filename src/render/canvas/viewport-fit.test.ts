// src/render/canvas/viewport-fit.test.ts
import { describe, expect, it } from 'vitest';
import { canPaint, fitToBounds, visibleWorldRect, worldToScreen } from './viewport';

describe('fitToBounds con un diagrama del tamaño de prueba', () => {
  const bounds = { x: -16, y: -40, w: 12881, h: 2580 };

  it('deja todo el diagrama dentro del viewport', () => {
    const v = fitToBounds(bounds, 826, 907);
    const a = worldToScreen(v, bounds.x, bounds.y);
    const b = worldToScreen(v, bounds.x + bounds.w, bounds.y + bounds.h);
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(b.x).toBeLessThanOrEqual(826);
    expect(b.y).toBeLessThanOrEqual(907);
    expect(v.scale).toBeCloseTo(0.0579, 3);
  });

  it('el rectángulo visible contiene los bounds', () => {
    const v = fitToBounds(bounds, 826, 907);
    const r = visibleWorldRect(v, 826, 907);
    expect(r.x).toBeLessThanOrEqual(bounds.x);
    expect(r.y).toBeLessThanOrEqual(bounds.y);
    expect(r.x + r.w).toBeGreaterThanOrEqual(bounds.x + bounds.w);
    expect(r.y + r.h).toBeGreaterThanOrEqual(bounds.y + bounds.h);
  });
});

describe('canPaint', () => {
  it('pinta con tamaño positivo', () => {
    expect(canPaint({ w: 826, h: 907 })).toBe(true);
  });

  it('no pinta con tamaño cero o no finito', () => {
    expect(canPaint({ w: 0, h: 907 })).toBe(false);
    expect(canPaint({ w: 826, h: 0 })).toBe(false);
    expect(canPaint({ w: Number.NaN, h: 10 })).toBe(false);
  });
});
