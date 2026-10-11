// tests/presentation/diagram/canvas/color.test.ts — texto legible sobre un relleno de color (T9: mapa de calor).
import { describe, expect, it } from 'vitest';
import { readableOn } from '../../../../src/presentation/diagram/canvas/color';

describe('readableOn', () => {
  it('elige negro o blanco, el de MÁS contraste (no un umbral fijo de luminancia)', () => {
    // #3987e5: blanco da 3.64:1 y negro 5.77:1 → negro (textOn, con umbral 0.4, elegiría blanco).
    expect(readableOn('#3987e5')).toBe('#000000');
    expect(readableOn('#1c5cab')).toBe('#ffffff');
    expect(readableOn('#cde2fb')).toBe('#000000');
    expect(readableOn('#0d366b')).toBe('#ffffff');
  });

  it('color que no se entiende: negro', () => {
    expect(readableOn('papaya')).toBe('#000000');
  });
});
