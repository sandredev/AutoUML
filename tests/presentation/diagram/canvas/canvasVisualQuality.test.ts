// Tests puros de T4 en canvas/style/graph: migración de overrides, foco, minimapa, skin y medida con display.
import { describe, expect, it } from 'vitest';
import { focusOf } from '../../../../src/presentation/diagram/graph/focus';
import { cardContentOf, measureCardBox, moreText } from '../../../../src/presentation/diagram/layout/cardModel';
import { applySkin, linetypeOf, skinKey, visibilityIconsOf } from '../../../../src/presentation/diagram/style/skin';
import { DEFAULT_DETAIL, DEFAULT_DISPLAY } from '../../../../src/presentation/diagram/style/contract';
import { typeNode } from '../../../helpers/diagramBuilders';
import type { LayoutResult } from '../../../../src/presentation/diagram/types';
import type { Theme } from '../../../../src/presentation/diagram/canvas/draw';
import { centerViewOn, minimapToWorld, minimapTransform } from '../../../../src/presentation/diagram/canvas/minimap';
import { applyOverrides, EMPTY_OVERRIDES, moveBy, retainOverrides } from '../../../../src/presentation/diagram/canvas/overrides';

const layout: LayoutResult = {
  nodes: [
    { id: 'A', x: 0, y: 0, w: 100, h: 50 },
    { id: 'B', x: 200, y: 0, w: 100, h: 50 },
    { id: 'C', x: 400, y: 0, w: 100, h: 50 },
  ],
  edges: [
    { source: 'A', target: 'B', type: 'ASSOCIATION', points: [100, 25, 200, 25] },
    { source: 'B', target: 'C', type: 'ASSOCIATION', points: [300, 25, 400, 25] },
  ],
  packages: [],
  notes: [{ id: 'n', x: 0, y: 80, w: 60, h: 30, lines: ['x'], anchor: 'A' }],
  bounds: { x: 0, y: 0, w: 500, h: 110 },
};

describe('overrides al cambiar de modelo (T4, bug 3)', () => {
  it('retainOverrides conserva los ids que siguen y devuelve el mismo mapa si no pierde ninguno', () => {
    const o = moveBy(moveBy(EMPTY_OVERRIDES, 'A', 10, 0), 'Gone', 5, 5);
    const kept = retainOverrides(o, ['A', 'B']);
    expect([...kept.keys()]).toEqual(['A']);
    expect(retainOverrides(kept, ['A'])).toBe(kept);
    expect(retainOverrides(moveBy(EMPTY_OVERRIDES, 'Z', 1, 1), ['A'])).toBe(EMPTY_OVERRIDES);
  });

  it('las notas ancladas acompañan a su clase al arrastrarla', () => {
    const out = applyOverrides(layout, moveBy(EMPTY_OVERRIDES, 'A', 0, 40));
    expect(out.notes?.[0]?.y).toBe(120);
    expect(out.bounds.y + out.bounds.h).toBeGreaterThanOrEqual(150);
  });
});

describe('focusOf (T4)', () => {
  it('clase: ella, sus vecinos y sus aristas', () => {
    const f = focusOf(layout, 'B', null);
    expect([...(f?.nodes ?? [])].sort()).toEqual(['A', 'B', 'C']);
    expect([...(f?.edges ?? [])]).toEqual([0, 1]);
  });
  it('arista: ella y sus dos clases (tiene prioridad sobre la clase)', () => {
    const f = focusOf(layout, 'B', 0);
    expect([...(f?.nodes ?? [])].sort()).toEqual(['A', 'B']);
    expect([...(f?.edges ?? [])]).toEqual([0]);
  });
  it('sin selección o con un id que no está: sin foco', () => {
    expect(focusOf(layout, null, null)).toBeNull();
    expect(focusOf(layout, 'Nope', null)).toBeNull();
  });
});

describe('minimapa (T4)', () => {
  it('ida y vuelta mundo ↔ minimapa y centrado de la vista', () => {
    const t = minimapTransform(layout.bounds, 180, 120);
    expect(t).not.toBeNull();
    const p = minimapToWorld(t!, t!.ox + 250 * t!.scale, t!.oy + 55 * t!.scale);
    expect(p.x).toBeCloseTo(250);
    expect(p.y).toBeCloseTo(55);
    const v = centerViewOn({ scale: 2, tx: 0, ty: 0 }, 250, 55, 800, 600);
    expect(v).toEqual({ scale: 2, tx: 400 - 500, ty: 300 - 110 });
  });
  it('sin tamaño o sin diagrama no hay transformación', () => {
    expect(minimapTransform(layout.bounds, 0, 120)).toBeNull();
    expect(minimapTransform({ x: 0, y: 0, w: 0, h: 0 }, 180, 120)).toBeNull();
  });
});

describe('skinparam en el tema (T4)', () => {
  const theme = { bg: '#fff', card: '#eee', cardBorder: '#000', edge: '#111', pkg: '#555' } as Theme;
  it('aplica colores y deja igual el tema sin skinparam', () => {
    expect(applySkin(theme, undefined)).toBe(theme);
    expect(applySkin(theme, { linetype: 'ortho' })).toBe(theme);
    const t = applySkin(theme, { classbackgroundcolor: '#LightBlue', arrowcolor: 'red', packagebackgroundcolor: '#FAFAFA', backgroundcolor: 'white' });
    expect(t).toMatchObject({ card: 'LightBlue', edge: 'red', pkgBg: '#FAFAFA', bg: 'white' });
  });
  it('linetype, iconos de visibilidad y clave de invalidación', () => {
    expect(linetypeOf({ linetype: 'Polyline' })).toBe('polyline');
    expect(linetypeOf({ linetype: 'splines' })).toBeUndefined();
    expect(visibilityIconsOf({ classattributeiconsize: '0' })).toBe(false);
    expect(visibilityIconsOf({})).toBe(true);
    expect(skinKey({ arrowcolor: 'red' })).not.toBe(skinKey({ arrowcolor: 'blue' }));
  });
});

describe('medida de tarjetas con display (T4)', () => {
  const m = (text: string): number => text.length * 7;
  const t = typeNode('Cliente', {
    stereotypes: ['Entity'],
    attributes: [{ name: 'id', type: 'long', visibility: '-', isStatic: false }],
  });

  it('hide circle estrecha la tarjeta y hide stereotype baja la cabecera', () => {
    const base = measureCardBox(cardContentOf(t, DEFAULT_DETAIL, false), m);
    const noCircle = measureCardBox(cardContentOf(t, DEFAULT_DETAIL, false, { ...DEFAULT_DISPLAY, showCircle: false }), m);
    const noStereo = measureCardBox(cardContentOf(t, DEFAULT_DETAIL, false, { ...DEFAULT_DISPLAY, showStereotype: false }), m);
    expect(noCircle.w).toBeLessThanOrEqual(base.w);
    expect(noStereo.h).toBeLessThan(base.h);
  });

  it('classAttributeIconSize 0 quita el prefijo de visibilidad', () => {
    const c = cardContentOf(t, DEFAULT_DETAIL, false, { ...DEFAULT_DISPLAY, visibilityIcons: false });
    expect(c.sections[0]?.[0]?.text).toBe('id: long');
  });

  it('hide fields quita el compartimento; empty members respeta los vacíos', () => {
    const c = cardContentOf(t, DEFAULT_DETAIL, false, { ...DEFAULT_DISPLAY, hideFields: true });
    expect(c.sections).toEqual([]);
    const showEmpty = { ...DEFAULT_DETAIL, hideEmptyCompartments: false };
    expect(cardContentOf(typeNode('V'), showEmpty, false).sections).toHaveLength(2);
    expect(cardContentOf(typeNode('V'), showEmpty, false, { ...DEFAULT_DISPLAY, hideEmptyFields: true, hideEmptyMethods: true }).sections).toEqual([]);
  });

  it('"… +N más" usa la plantilla traducida', () => {
    expect(moreText(3)).toBe('… +3 más');
    expect(moreText(3, '… +{n} more')).toBe('… +3 more');
  });
});
