// tests/presentation/diagram/canvas/keyboardNav.test.ts — atajos de teclado del canvas (T10.6).
import { describe, expect, it } from 'vitest';
import { buildAdjacency } from '../../../../src/presentation/diagram/graph/adjacency';
import { nextConnected, shortcutOf } from '../../../../src/presentation/diagram/canvas/keyboardNav';
import { diagram, rel, typeNode } from '../../../helpers/diagramBuilders';

// B conecta con A (entrante), C y D (salientes); E aislado.
const adj = buildAdjacency(
  diagram(
    ['A', 'B', 'C', 'D', 'E'].map((id) => typeNode(id)),
    [rel('D', 'B'), rel('A', 'B'), rel('B', 'C')],
  ),
);

describe('nextConnected', () => {
  it('recorre vecinos (entrantes y salientes) ordenados por id', () => {
    expect(nextConnected(adj, 'B', 'next', null)).toBe('A');
    expect(nextConnected(adj, 'B', 'next', 'A')).toBe('C');
    expect(nextConnected(adj, 'B', 'next', 'C')).toBe('D');
  });

  it('es cíclico en ambas direcciones', () => {
    expect(nextConnected(adj, 'B', 'next', 'D')).toBe('A');
    expect(nextConnected(adj, 'B', 'prev', null)).toBe('D');
    expect(nextConnected(adj, 'B', 'prev', 'A')).toBe('D');
    expect(nextConnected(adj, 'B', 'prev', 'D')).toBe('C');
  });

  it('sin selección va al primer nodo por id', () => {
    expect(nextConnected(adj, null, 'next', null)).toBe('A');
  });

  it('un nodo sin conexiones no se mueve', () => {
    expect(nextConnected(adj, 'E', 'next', null)).toBeNull();
  });
});

describe('shortcutOf', () => {
  const k = (key: string, mods: { ctrl?: boolean; alt?: boolean; meta?: boolean } = {}) => shortcutOf(key, mods);

  it('mapea teclas a acciones', () => {
    expect(k('ArrowRight')).toBe('next');
    expect(k('ArrowDown')).toBe('next');
    expect(k('ArrowLeft')).toBe('prev');
    expect(k('ArrowUp')).toBe('prev');
    expect(k('Enter')).toBe('focus');
    expect(k('+')).toBe('zoomIn');
    expect(k('=')).toBe('zoomIn');
    expect(k('-')).toBe('zoomOut');
    expect(k('0')).toBe('fit');
    expect(k('?')).toBe('help');
  });

  it('ignora otras teclas y combinaciones con Ctrl/Alt/Meta', () => {
    expect(k('a')).toBeNull();
    expect(k('0', { ctrl: true })).toBeNull();
    expect(k('+', { meta: true })).toBeNull();
    expect(k('Enter', { alt: true })).toBeNull();
  });
});
