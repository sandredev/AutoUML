import { describe, expect, it } from 'vitest';
import type { LayoutResult } from '../types';
import {
  applyOverrides,
  moveStart,
  overridesFromRecord,
  overridesToRecord,
  setOverride,
  EMPTY_OVERRIDES,
} from './overrides';

function layout(): LayoutResult {
  return {
    nodes: [
      { id: 'A', x: 0, y: 0, w: 80, h: 40, packageName: 'p' },
      { id: 'B', x: 200, y: 0, w: 80, h: 40, packageName: 'p' },
    ],
    edges: [{ source: 'A', target: 'B', type: 'ASSOCIATION', routing: 'orthogonal', points: [80, 20, 200, 20] }],
    packages: [{ name: 'p', x: -30, y: -50, w: 340, h: 120 }],
    bounds: { x: -30, y: -50, w: 340, h: 120 },
  };
}

describe('moveStart con obstáculos', () => {
  it('el codo ingenuo que cruzaría una tarjeta elige la ruta limpia', () => {
    // Tramo horizontal y=50; al mover el inicio a y=90 el codo ingenuo iría por y=90.
    const pts = [10, 50, 110, 50];
    const obstacle = { x: 40, y: 80, w: 60, h: 20 };
    const def = moveStart(pts.slice(), { dx: 0, dy: 40 }, true);
    // Sin obstáculos mantiene el comportamiento actual (codo horizontal primero).
    expect(def).toEqual([10, 90, 110, 90, 110, 50]);
    const clean = moveStart(pts.slice(), { dx: 0, dy: 40 }, true, [obstacle]);
    // La alternativa vertical evita la caja: (10,90) → (10,50) → (110,50).
    expect(clean).toEqual([10, 90, 10, 50, 110, 50]);
  });

  it('sin cruce mantiene el codo actual aunque haya obstáculos lejos', () => {
    const pts = [10, 50, 110, 50];
    const far = { x: 500, y: 500, w: 10, h: 10 };
    expect(moveStart(pts.slice(), { dx: 0, dy: 40 }, true, [far])).toEqual([10, 90, 110, 90, 110, 50]);
  });
});

describe('applyOverrides con paquetes', () => {
  it('mover una tarjeta fuera encoge su paquete pero la sigue conteniendo', () => {
    const l = layout();
    const before = l.packages[0];
    const out = applyOverrides(l, setOverride(EMPTY_OVERRIDES, 'A', { dx: 400, dy: 0 }));
    const after = out.packages[0];
    expect(after).toBeDefined();
    // La tarjeta escapó a x=400: el paquete la contiene…
    if (!after) return;
    expect(after.x + after.w).toBeGreaterThanOrEqual(400 + 80 + 16);
    // …pero el lado izquierdo abandonado se encoge (ya no baja hasta -16).
    expect(after.x).toBeGreaterThan(before?.x ?? 0);
    // La otra tarjeta sigue dentro.
    expect(after.x).toBeLessThanOrEqual(200 - 16);
  });

  it('mover dentro agranda como antes y lo ajeno no cambia', () => {
    const l = layout();
    const out = applyOverrides(l, setOverride(EMPTY_OVERRIDES, 'A', { dx: 5, dy: 5 }));
    const after = out.packages[0];
    const before = l.packages[0];
    expect(after).toEqual(before);
  });

  it('un paquete sin miembros visibles conserva la caja del layout', () => {
    const l = layout();
    const withGhost: LayoutResult = {
      ...l,
      packages: [...l.packages, { name: 'vacio', x: 0, y: 0, w: 50, h: 50 }],
    };
    const out = applyOverrides(withGhost, setOverride(EMPTY_OVERRIDES, 'A', { dx: 400, dy: 0 }));
    expect(out.packages.find((p) => p.name === 'vacio')).toEqual({ name: 'vacio', x: 0, y: 0, w: 50, h: 50 });
  });
});

describe('overridesFromRecord / overridesToRecord', () => {
  it('round-trip con filtrado de no-finitos', () => {
    const map = overridesFromRecord({ A: { dx: 1, dy: 2 }, B: { dx: Number.NaN, dy: 0 } });
    expect(map.get('A')).toEqual({ dx: 1, dy: 2 });
    expect(map.has('B')).toBe(false);
    expect(overridesToRecord(map)).toEqual({ A: { dx: 1, dy: 2 } });
    expect(overridesFromRecord({})).toBe(EMPTY_OVERRIDES);
  });
});
