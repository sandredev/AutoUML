import { describe, expect, it } from 'vitest';
import type { LayoutResult } from '../../../../src/presentation/diagram/types';
import { buildIndex } from '../../../../src/presentation/diagram/canvas/spatial';
import {
  EMPTY_SELECTION,
  marqueeSelection,
  nodesInRect,
  packageMemberIds,
  rectBetween,
  sameSelection,
  single,
  toggleIn,
} from '../../../../src/presentation/diagram/canvas/selection';

function layout(): LayoutResult {
  return {
    nodes: [
      { id: 'A', x: 0, y: 0, w: 100, h: 50, packageName: 'a' },
      { id: 'B', x: 200, y: 0, w: 100, h: 50, packageName: 'a.b' },
      { id: 'C', x: 0, y: 200, w: 100, h: 50, packageName: 'ab' },
    ],
    edges: [],
    packages: [],
    bounds: { x: 0, y: 0, w: 300, h: 250 },
  };
}

describe('selection', () => {
  it('rectBetween normaliza los cuatro sentidos de arrastre', () => {
    expect(rectBetween(10, 20, 30, 40)).toEqual({ x: 10, y: 20, w: 20, h: 20 });
    expect(rectBetween(30, 40, 10, 20)).toEqual({ x: 10, y: 20, w: 20, h: 20 });
    expect(rectBetween(30, 20, 10, 40)).toEqual({ x: 10, y: 20, w: 20, h: 20 });
    expect(rectBetween(10, 40, 30, 20)).toEqual({ x: 10, y: 20, w: 20, h: 20 });
  });

  it('nodesInRect devuelve ids (no índices) e incluye cajas parcialmente tocadas', () => {
    const L = layout();
    const ix = buildIndex(L);
    expect(nodesInRect(L, ix, { x: 50, y: 10, w: 200, h: 30 })).toEqual(['A', 'B']);
    expect(nodesInRect(L, ix, { x: 500, y: 500, w: 10, h: 10 })).toEqual([]);
  });

  it('packageMemberIds incluye subpaquetes a.b para a y excluye ab', () => {
    const L = layout();
    expect(packageMemberIds(L, 'a').sort()).toEqual(['A', 'B']);
    expect(packageMemberIds(L, 'a.b')).toEqual(['B']);
    expect(packageMemberIds(L, 'zzz')).toEqual([]);
  });

  it('toggleIn añade, quita cuando todos están y reasigna la primaria', () => {
    const added = toggleIn(single(null), ['A', 'B']);
    expect(added.id).toBe('A');
    expect([...added.ids].sort()).toEqual(['A', 'B']);
    const removed = toggleIn(added, ['A', 'B']);
    expect(removed.id).toBeNull();
    expect(removed.ids.size).toBe(0);
    // Quitar la primaria conserva otra que siga dentro.
    const keep = toggleIn({ id: 'A', ids: new Set(['A', 'B']) }, ['A']);
    expect(keep.id).toBe('B');
    expect([...keep.ids]).toEqual(['B']);
    // Vacío: devuelve la misma selección.
    expect(toggleIn(added, [])).toBe(added);
  });

  it('marqueeSelection sustituye sin Ctrl, une con Ctrl y conserva la primaria', () => {
    const base = { id: 'A', ids: new Set(['A', 'Z']) };
    const replaced = marqueeSelection(base, ['B', 'C'], false);
    expect([...replaced.ids].sort()).toEqual(['B', 'C']);
    expect(replaced.id).toBe('B');
    const added = marqueeSelection(base, ['B'], true);
    expect([...added.ids].sort()).toEqual(['A', 'B', 'Z']);
    expect(added.id).toBe('A');
    const out = marqueeSelection(base, [], true);
    expect(out.id).toBe('A');
    expect([...out.ids]).toEqual(['A', 'Z']);
  });

  it('sameSelection compara primaria y conjunto', () => {
    expect(sameSelection(single('A'), single('A'))).toBe(true);
    expect(sameSelection(single('A'), single('B'))).toBe(false);
    expect(sameSelection({ id: 'A', ids: new Set(['A', 'B']) }, single('A'))).toBe(false);
    expect(EMPTY_SELECTION.size).toBe(0);
  });
});
