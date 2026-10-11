// tests/presentation/diagram/presentation/player.test.ts — recorrido de presentación (T10.4).
import { describe, expect, it } from 'vitest';
import {
  animatesTransition,
  clampIndex,
  presentationReducer,
  startPresentation,
} from '../../../../src/presentation/diagram/presentation/player';

describe('recorrido ←/→', () => {
  it('no arranca sin vistas', () => {
    expect(startPresentation(0).active).toBe(false);
  });

  it('arranca en la primera vista (o en la pedida, acotada)', () => {
    expect(startPresentation(3)).toEqual({ active: true, index: 0 });
    expect(startPresentation(3, 2).index).toBe(2);
    expect(startPresentation(3, 9).index).toBe(2);
  });

  it('next/prev avanzan sin dar la vuelta', () => {
    let s = startPresentation(2);
    s = presentationReducer(s, { type: 'prev', count: 2 });
    expect(s.index).toBe(0);
    s = presentationReducer(s, { type: 'next', count: 2 });
    s = presentationReducer(s, { type: 'next', count: 2 });
    expect(s.index).toBe(1);
  });

  it('exit desactiva la presentación y conserva el índice', () => {
    const s = presentationReducer(startPresentation(3, 1), { type: 'exit' });
    expect(s).toEqual({ active: false, index: 1 });
  });
});

describe('clampIndex (la lista cambia desde el panel durante el recorrido)', () => {
  it('acota al último y nunca baja de 0', () => {
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(1, 3)).toBe(1);
    expect(clampIndex(0, 0)).toBe(0);
  });
});

describe('animatesTransition', () => {
  it('anima con el motor de tween existente', () => {
    expect(animatesTransition(false)).toBe(true);
  });

  it('con movimiento reducido salta directo a la vista', () => {
    expect(animatesTransition(true)).toBe(false);
  });
});
