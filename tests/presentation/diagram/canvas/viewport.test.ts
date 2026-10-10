import { describe, expect, it } from 'vitest';
import { fitToBounds, screenToWorld, visibleWorldRect, worldToScreen, zoomAt } from '../../../../src/presentation/diagram/canvas/viewport';

describe('viewport', () => {
  it('zoomAt mantiene fijo el punto del cursor', () => {
    const v = { scale: 0.7, tx: 30, ty: -20 };
    const before = screenToWorld(v, 200, 150);
    const z = zoomAt(v, 1.8, 200, 150);
    const after = screenToWorld(z, 200, 150);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(z.scale).toBeCloseTo(1.26, 9);
  });

  it('zoomAt respeta los límites', () => {
    expect(zoomAt({ scale: 3.9, tx: 0, ty: 0 }, 10, 0, 0).scale).toBe(4);
    expect(zoomAt({ scale: 0.03, tx: 0, ty: 0 }, 0.01, 0, 0).scale).toBe(0.02);
  });

  it('fitToBounds deja todo visible', () => {
    const b = { x: -500, y: 100, w: 4000, h: 1500 };
    const v = fitToBounds(b, 800, 600);
    const r = visibleWorldRect(v, 800, 600);
    expect(r.x).toBeLessThanOrEqual(b.x);
    expect(r.y).toBeLessThanOrEqual(b.y);
    expect(r.x + r.w).toBeGreaterThanOrEqual(b.x + b.w);
    expect(r.y + r.h).toBeGreaterThanOrEqual(b.y + b.h);
  });

  it('ida y vuelta mundo↔pantalla', () => {
    const v = { scale: 1.7, tx: 12, ty: -9 };
    const s = worldToScreen(v, 33, 44);
    const w = screenToWorld(v, s.x, s.y);
    expect(w.x).toBeCloseTo(33, 9);
    expect(w.y).toBeCloseTo(44, 9);
  });
});
