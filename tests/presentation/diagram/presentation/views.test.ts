// tests/presentation/diagram/presentation/views.test.ts — vistas de presentación en layout.json (T10).
import { describe, expect, it } from 'vitest';
import {
  addView,
  moveView,
  removeView,
  renameView,
  serializeViews,
  stepView,
  validateViews,
  type DeckView,
} from '../../../../src/presentation/diagram/presentation/views';

const view = (title: string, extra: Partial<DeckView> = {}): DeckView => ({ title, view: { scale: 1, tx: 0, ty: 0 }, ...extra });

describe('validateViews', () => {
  it('no es array → undefined', () => {
    expect(validateViews(undefined)).toBeUndefined();
    expect(validateViews({})).toBeUndefined();
  });

  it('acepta una vista mínima y una completa', () => {
    const full = view('B', { filters: { hideExternal: true }, focusKey: 'T1', collapsed: ['p'] });
    expect(validateViews([view('A'), full])).toEqual([view('A'), full]);
  });

  it('descarta entradas inválidas sin perder el resto', () => {
    const r = validateViews([
      view('ok'),
      null,
      { title: 3, view: { scale: 1, tx: 0, ty: 0 } },
      { title: 'sin vista' },
      { title: 'escala 0', view: { scale: 0, tx: 0, ty: 0 } },
      { title: 'NaN', view: { scale: 1, tx: Number.NaN, ty: 0 } },
    ]);
    expect(r).toEqual([view('ok')]);
  });

  it('opcionales malos se descartan campo a campo y no se copian desconocidos', () => {
    const r = validateViews([{ ...view('x'), focusKey: 5, collapsed: ['a', 2, 'b'], extra: 1, filters: 'no' }]);
    expect(r).toEqual([{ title: 'x', view: { scale: 1, tx: 0, ty: 0 }, collapsed: ['a', 'b'] }]);
  });

  it('usa el validador de filtros inyectado', () => {
    const r = validateViews([{ ...view('x'), filters: { hideExternal: true, raro: 1 } }], () => ({ hideExternal: true }));
    expect(r?.[0].filters).toEqual({ hideExternal: true });
  });
});

describe('serializeViews', () => {
  it('ida y vuelta sin pérdidas', () => {
    const vs = [view('A', { focusKey: 'T', collapsed: [] }), view('B', { filters: { hiddenTypes: ['X'] } })];
    expect(validateViews(JSON.parse(JSON.stringify(serializeViews(vs))))).toEqual(vs);
  });

  it('no copia campos undefined', () => {
    expect(Object.keys(serializeViews([{ ...view('A'), focusKey: undefined }])[0])).toEqual(['title', 'view']);
  });
});

describe('operaciones (inmutables)', () => {
  const vs = [view('A'), view('B'), view('C')];

  it('addView añade al final', () => {
    expect(addView(vs, view('D')).map((v) => v.title)).toEqual(['A', 'B', 'C', 'D']);
    expect(vs).toHaveLength(3);
  });

  it('removeView y renameView', () => {
    expect(removeView(vs, 1).map((v) => v.title)).toEqual(['A', 'C']);
    expect(renameView(vs, 2, 'Z').map((v) => v.title)).toEqual(['A', 'B', 'Z']);
    expect(removeView(vs, 9)).toEqual(vs);
  });

  it('moveView reordena y acota', () => {
    expect(moveView(vs, 0, 2).map((v) => v.title)).toEqual(['B', 'C', 'A']);
    expect(moveView(vs, 2, -5).map((v) => v.title)).toEqual(['C', 'A', 'B']);
  });

  it('stepView avanza y retrocede sin salirse', () => {
    expect(stepView(0, 3, 1)).toBe(1);
    expect(stepView(2, 3, 1)).toBe(2);
    expect(stepView(0, 3, -1)).toBe(0);
    expect(stepView(0, 0, 1)).toBe(-1);
  });
});
