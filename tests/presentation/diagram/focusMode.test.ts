// tests/presentation/diagram/focusMode.test.ts — objetivo del modo foco y atajos de teclado del visor (T8).
import { describe, expect, it } from 'vitest';
import { focusTargetOf, focusToggle, viewerShortcut } from '../../../src/presentation/diagram/focusMode';
import { aggregateCollapsed, PACKAGE_NODE_PREFIX } from '../../../src/presentation/diagram/layout/aggregate';
import { diagram, rel, typeNode } from '../../helpers/diagramBuilders';

const source = diagram(
  [typeNode('A', { packageName: 'app' }), typeNode('B', { packageName: 'app.sub' }), typeNode('C', { packageName: 'core' })],
  [rel('A', 'C'), rel('B', 'C')],
);

describe('focusTargetOf', () => {
  it('sin selección no hay objetivo', () => {
    expect(focusTargetOf(null, source, source, new Set())).toBeNull();
  });

  it('una clase visible se enfoca a sí misma', () => {
    expect(focusTargetOf('C', source, source, new Set())).toBe('C');
  });

  it('una clase dentro de un paquete plegado enfoca el paquete (el más externo)', () => {
    const collapsed = new Set(['app']);
    const agg = aggregateCollapsed(source, collapsed).model;
    expect(focusTargetOf('B', agg, source, collapsed)).toBe(PACKAGE_NODE_PREFIX + 'app');
  });

  it('el propio nodo de un paquete plegado se puede enfocar', () => {
    const collapsed = new Set(['app']);
    const agg = aggregateCollapsed(source, collapsed).model;
    expect(focusTargetOf(PACKAGE_NODE_PREFIX + 'app', agg, source, collapsed)).toBe(PACKAGE_NODE_PREFIX + 'app');
  });

  it('un id que no existe (p. ej. oculto con hide): null', () => {
    expect(focusTargetOf('Nadie', source, source, new Set())).toBeNull();
  });
});

describe('viewerShortcut', () => {
  const canvas = { tagName: 'CANVAS', isContentEditable: false };
  const ev = (key: string, extra: Record<string, unknown> = {}) =>
    ({ key, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, target: canvas, ...extra });

  it('F (mayúscula o minúscula) alterna el foco; ⌫ sale', () => {
    expect(viewerShortcut(ev('f'))).toBe('toggle-focus');
    expect(viewerShortcut(ev('F'))).toBe('toggle-focus');
    expect(viewerShortcut(ev('Escape'))).toBe('escape');
    expect(viewerShortcut(ev('Backspace'))).toBe('back');
  });

  it('Enter alterna el foco solo cuando el objetivo es el canvas (no un botón)', () => {
    expect(viewerShortcut(ev('Enter'))).toBe('toggle-focus');
    expect(viewerShortcut(ev('Enter', { target: { tagName: 'BUTTON', isContentEditable: false } }))).toBeNull();
  });

  it('con Ctrl, Meta o Alt no es un atajo del visor', () => {
    expect(viewerShortcut(ev('f', { ctrlKey: true }))).toBeNull();
    expect(viewerShortcut(ev('f', { metaKey: true }))).toBeNull();
    expect(viewerShortcut(ev('f', { altKey: true }))).toBeNull();
  });

  it('escribiendo en un campo o en el editor (contenteditable) no se intercepta', () => {
    expect(viewerShortcut(ev('f', { target: { tagName: 'INPUT', isContentEditable: false } }))).toBeNull();
    expect(viewerShortcut(ev('f', { target: { tagName: 'TEXTAREA', isContentEditable: false } }))).toBeNull();
    expect(viewerShortcut(ev('Backspace', { target: { tagName: 'INPUT', isContentEditable: false } }))).toBeNull();
    expect(viewerShortcut(ev('f', { target: { tagName: 'DIV', isContentEditable: true } }))).toBeNull();
  });

  it('Retroceso con el foco en un desplegable sale por capas (F no)', () => {
    const select = { tagName: 'SELECT', isContentEditable: false };
    expect(viewerShortcut(ev('Escape', { target: select }))).toBe('escape');
    expect(viewerShortcut(ev('Backspace', { target: select }))).toBe('back');
    expect(viewerShortcut(ev('f', { target: select }))).toBeNull();
  });

  it('un evento ya atendido (defaultPrevented) se ignora; otras teclas también', () => {
    expect(viewerShortcut(ev('Backspace', { defaultPrevented: true }))).toBeNull();
    expect(viewerShortcut(ev('g'))).toBeNull();
  });
});

describe('focusToggle (F)', () => {
  it('sin foco entra en el de la selección; sin selección no hace nada', () => {
    expect(focusToggle(null, 'A')).toBe('enter');
    expect(focusToggle(null, null)).toBeNull();
  });

  it('en foco: otra selección cambia el foco a ella; la misma (o ninguna) sale', () => {
    expect(focusToggle('A', 'B')).toBe('enter');
    expect(focusToggle('A', 'A')).toBe('exit');
    expect(focusToggle('A', null)).toBe('exit');
  });
});
