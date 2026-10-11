// tests/presentation/diagram/presentation/player.test.ts — recorrido de presentación (T10.4).
import { describe, expect, it } from 'vitest';
import {
  presentationReducer,
  startPresentation,
  transitionPlan,
} from '../../../../src/presentation/diagram/presentation/player';
import { EASE_IN_OUT, VIEW_MS } from '../../../../src/presentation/diagram/canvas/tween';
import type { DeckView } from '../../../../src/presentation/diagram/presentation/views';

const v = (title: string): DeckView => ({ title, view: { scale: 1, tx: 0, ty: 0 } });
const titles = (s: { views: readonly DeckView[] }): string[] => s.views.map((x) => x.title);

describe('recorrido ←/→', () => {
  it('no arranca sin vistas', () => {
    expect(startPresentation([]).active).toBe(false);
  });

  it('arranca en la primera vista (o en la pedida, acotada)', () => {
    const views = [v('A'), v('B'), v('C')];
    expect(startPresentation(views)).toMatchObject({ active: true, index: 0 });
    expect(startPresentation(views, 2).index).toBe(2);
    expect(startPresentation(views, 9).index).toBe(2);
  });

  it('next/prev avanzan sin dar la vuelta', () => {
    let s = startPresentation([v('A'), v('B')]);
    s = presentationReducer(s, { type: 'prev' });
    expect(s.index).toBe(0);
    s = presentationReducer(s, { type: 'next' });
    s = presentationReducer(s, { type: 'next' });
    expect(s.index).toBe(1);
  });

  it('exit desactiva la presentación y conserva las vistas', () => {
    const s = presentationReducer(startPresentation([v('A')]), { type: 'exit' });
    expect(s.active).toBe(false);
    expect(titles(s)).toEqual(['A']);
  });
});

describe('gestión de vistas durante la presentación', () => {
  const base = () => startPresentation([v('A'), v('B'), v('C')], 1);

  it('renombrar cambia solo el título', () => {
    const s = presentationReducer(base(), { type: 'rename', index: 0, title: 'Inicio' });
    expect(titles(s)).toEqual(['Inicio', 'B', 'C']);
    expect(s.index).toBe(1);
  });

  it('reordenar hace que la vista actual siga siendo la misma', () => {
    const s = presentationReducer(base(), { type: 'move', from: 1, to: 0 });
    expect(titles(s)).toEqual(['B', 'A', 'C']);
    expect(s.index).toBe(0);
    const t = presentationReducer(base(), { type: 'move', from: 0, to: 2 });
    expect(titles(t)).toEqual(['B', 'C', 'A']);
    expect(t.index).toBe(0);
  });

  it('borrar antes de la actual la mantiene; borrar la actual selecciona la siguiente', () => {
    const before = presentationReducer(base(), { type: 'remove', index: 0 });
    expect(titles(before)).toEqual(['B', 'C']);
    expect(before.index).toBe(0);
    const cur = presentationReducer(base(), { type: 'remove', index: 1 });
    expect(titles(cur)).toEqual(['A', 'C']);
    expect(cur.index).toBe(1);
  });

  it('borrar la última estando en ella retrocede; borrar todas sale', () => {
    let s = startPresentation([v('A'), v('B')], 1);
    s = presentationReducer(s, { type: 'remove', index: 1 });
    expect(s).toMatchObject({ index: 0, active: true });
    s = presentationReducer(s, { type: 'remove', index: 0 });
    expect(s).toMatchObject({ active: false, views: [] });
  });
});

describe('transitionPlan', () => {
  it('anima con el motor de tween existente', () => {
    expect(transitionPlan(false)).toEqual({ animate: true, durationMs: VIEW_MS, ease: EASE_IN_OUT });
  });

  it('con movimiento reducido salta directo a la vista', () => {
    expect(transitionPlan(true)).toMatchObject({ animate: false, durationMs: 0 });
  });
});
