// tests/presentation/diagram/canvas/keyboardNav.test.ts — atajos de teclado del canvas (T10.6).
import { describe, expect, it } from 'vitest';
import { hoverAfterKeyNav, pickEdge, visibleLinks, relationOrder, relatedNext, relationFlow, shortcutOf, spatialNext, stepAlong } from '../../../../src/presentation/diagram/canvas/keyboardNav';
import type { NodeBox } from '../../../../src/presentation/diagram/types';
import { rel } from '../../../helpers/diagramBuilders';

// Cruz alrededor de A (cajas 100×50): B a la derecha, C abajo, D a la izquierda, todas conectadas con A.
const box = (id: string, x: number, y: number): NodeBox => ({ id, x, y, w: 100, h: 50 });
const cross = { boxes: [box('A', 0, 0), box('B', 200, 0), box('C', 0, 200), box('D', -200, 0)] };

describe('spatialNext (flechas)', () => {
  it('va a la clase más cercana en la dirección pulsada', () => {
    expect(spatialNext(cross.boxes, 'A', 'right')).toBe('B');
    expect(spatialNext(cross.boxes, 'A', 'down')).toBe('C');
    expect(spatialNext(cross.boxes, 'A', 'left')).toBe('D');
  });

  it('llega a una clase sin relaciones aunque haya conectadas más lejos', () => {
    const boxes = [...cross.boxes, box('X', 120, 0)];
    expect(spatialNext(boxes, 'A', 'right')).toBe('X');
    expect(spatialNext(boxes, 'X', 'right')).toBe('B');
  });

  it('sin nada en esa dirección se queda donde está (null)', () => {
    expect(spatialNext(cross.boxes, 'A', 'up')).toBeNull();
  });

  it('sin selección va a la primera clase visible por id', () => {
    expect(spatialNext(cross.boxes.slice(1), null, 'right')).toBe('B');
  });
});

// A: EXTENDS con B (derecha), ASSOCIATION con C (abajo), COMPOSITION con D (izquierda) y con X (cerca, derecha).
const rels = [
  rel('A', 'B', { type: 'EXTENDS' }),
  rel('A', 'C', { type: 'ASSOCIATION' }),
  rel('D', 'A', { type: 'COMPOSITION' }),
  rel('A', 'X', { type: 'COMPOSITION' }),
];
const withX = [...cross.boxes, box('X', 120, 0)];

describe('relationFlow', () => {
  it('sin comentario: padre e hijo (EXTENDS: el padre es el destino)', () => {
    expect(relationFlow({ source: 'Hija', target: 'Padre', type: 'EXTENDS' })).toEqual([
      { kind: 'node', id: 'Padre' },
      { kind: 'node', id: 'Hija' },
    ]);
  });

  it('con comentario: entidad padre, comentario y entidad hija (dos pulsaciones para cruzarla)', () => {
    expect(relationFlow({ source: 'Todo', target: 'Parte', type: 'COMPOSITION', label: ' tiene ' })).toEqual([
      { kind: 'node', id: 'Todo' },
      { kind: 'label', text: 'tiene' },
      { kind: 'node', id: 'Parte' },
    ]);
  });

  it('un comentario vacío no cuenta', () => {
    expect(relationFlow({ source: 'A', target: 'B', type: 'ASSOCIATION', label: '  ' })).toHaveLength(2);
  });
});

describe('relationOrder / pickEdge (Mayús + flechas)', () => {
  // A en (0,0). Arriba: P1 (izq.) y P2 (dcha., algo más alta). Abajo: H1 (izq.) y H2 (dcha.). Z oculta.
  const boxes = [box('A', 0, 0), box('P1', -200, -200), box('P2', 200, -260), box('H1', -200, 200), box('H2', 200, 200)];
  const edges = [
    { source: 'A', target: 'P2', type: 'EXTENDS' as const },
    { source: 'H2', target: 'A', type: 'EXTENDS' as const },
    { source: 'A', target: 'P1', type: 'IMPLEMENTS' as const },
    { source: 'H1', target: 'A', type: 'ASSOCIATION' as const },
    { source: 'A', target: 'A', type: 'DEPENDENCY' as const },
    { source: 'A', target: 'Z', type: 'DEPENDENCY' as const },
    { source: 'P1', target: 'H1', type: 'ASSOCIATION' as const },
  ];
  const order = relationOrder(edges, boxes, 'A');

  it('primero las relaciones de arriba y luego las de abajo, cada fila de izquierda a derecha', () => {
    expect(order.map((s) => s.index)).toEqual([2, 0, 3, 1]);
  });

  it('→ va hacia la derecha y, al acabarse arriba, baja; ← al revés; cíclico', () => {
    expect(pickEdge(order, null, 'right')).toBe(2);
    expect(pickEdge(order, 2, 'right')).toBe(0);
    expect(pickEdge(order, 0, 'right')).toBe(3);
    expect(pickEdge(order, 1, 'right')).toBe(2);
    expect(pickEdge(order, 0, 'left')).toBe(2);
    expect(pickEdge(order, 3, 'left')).toBe(0);
    expect(pickEdge(order, null, 'left')).toBe(1);
  });

  it('↑/↓ cambian entre relaciones de arriba y de abajo (la más cercana); null si no hay', () => {
    expect(pickEdge(order, 2, 'down')).toBe(3);
    expect(pickEdge(order, 1, 'up')).toBe(0);
    expect(pickEdge(order, 2, 'up')).toBe(0);
    expect(pickEdge(order, 0, 'up')).toBeNull();
    expect(pickEdge(order, 3, 'down')).toBeNull();
  });

  it('sin relaciones visibles no hay nada que elegir', () => {
    expect(relationOrder(edges, [box('A', 0, 0)], 'A')).toEqual([]);
    expect(pickEdge([], null, 'right')).toBeNull();
  });
});

describe('stepAlong', () => {
  it('avanza y retrocede un paso del flujo sin salirse', () => {
    expect(stepAlong(3, 0, 'right')).toBe(1);
    expect(stepAlong(3, 1, 'down')).toBe(2);
    expect(stepAlong(3, 2, 'right')).toBe(2);
    expect(stepAlong(3, 0, 'left')).toBe(0);
    expect(stepAlong(2, 1, 'up')).toBe(0);
  });
});

describe('relatedNext (flechas en modo relaciones)', () => {
  it('solo mueve por vecinas del tipo elegido', () => {
    expect(relatedNext(withX, rels, 'A', 'EXTENDS', 'right')).toBe('B');
    expect(relatedNext(withX, rels, 'A', 'COMPOSITION', 'right')).toBe('X');
    expect(relatedNext(withX, rels, 'A', 'ASSOCIATION', 'down')).toBe('C');
  });

  it('sin vecina en esa dirección cicla por id (→/↓ primera, ←/↑ última)', () => {
    expect(relatedNext(withX, rels, 'A', 'COMPOSITION', 'up')).toBe('X');
    expect(relatedNext(withX, rels, 'A', 'COMPOSITION', 'down')).toBe('D');
  });

  it('con tipo null usa todas las relaciones', () => {
    expect(relatedNext(withX, rels, 'A', null, 'right')).toBe('X');
  });

  it('sin vecinas del tipo no se mueve (null); sin selección va a la primera por id', () => {
    expect(relatedNext(withX, rels, 'B', 'ASSOCIATION', 'right')).toBeNull();
    expect(relatedNext(cross.boxes.slice(1), rels, null, null, 'right')).toBe('B');
  });
});

describe('shortcutOf', () => {
  const k = (key: string, mods: { ctrl?: boolean; alt?: boolean; meta?: boolean } = {}) => shortcutOf(key, mods);

  it('mapea teclas a acciones', () => {
    expect(k('ArrowRight')).toBe('right');
    expect(k('ArrowDown')).toBe('down');
    expect(k('ArrowLeft')).toBe('left');
    expect(k('ArrowUp')).toBe('up');
    expect(k('+')).toBe('zoomIn');
    expect(k('=')).toBe('zoomIn');
    expect(k('-')).toBe('zoomOut');
    expect(k('0')).toBe('fit');
    expect(k('?')).toBe('help');
  });

  it('ignora otras teclas (Enter incluido) y combinaciones con Ctrl/Alt/Meta', () => {
    expect(k('a')).toBeNull();
    expect(k('Enter')).toBeNull();
    expect(k('0', { ctrl: true })).toBeNull();
    expect(k('+', { meta: true })).toBeNull();
  });
});

describe('hoverAfterKeyNav (#40: el resaltado no se queda en la entidad anterior)', () => {
  it('suelta el hover de la clase anterior al moverse a otra con flechas', () => {
    expect(hoverAfterKeyNav({ kind: 'node', id: 'A' }, 'B')).toBeNull();
  });

  it('suelta el hover de una relación al navegar', () => {
    expect(hoverAfterKeyNav({ kind: 'edge', index: 2 }, 'B')).toBeNull();
  });

  it('conserva el hover si ya apunta a la clase destino', () => {
    const h = { kind: 'node' as const, id: 'B' };
    expect(hoverAfterKeyNav(h, 'B')).toBe(h);
  });

  it('sin hover sigue sin hover', () => {
    expect(hoverAfterKeyNav(null, 'B')).toBeNull();
  });
});

describe('visibleLinks (el modo relaciones recorre lo que se ve)', () => {
  const edges = [
    { source: 'A', target: 'B', type: 'EXTENDS' as const },
    { source: 'A', target: 'C', type: 'ASSOCIATION' as const },
    { source: 'A', target: 'pkg:P', type: 'ASSOCIATION' as const },
    { source: 'A', target: 'D', type: 'ASSOCIATION' as const },
  ];

  it('sin filtros devuelve todas las aristas del layout (incluidas las de paquetes plegados)', () => {
    expect(visibleLinks(edges, null).map((e) => e.target)).toEqual(['B', 'C', 'pkg:P', 'D']);
  });

  it('descarta los tipos de relación ocultos y las que tocan una clase oculta', () => {
    const hidden = { nodes: new Set(['D']), relTypes: new Set(['ASSOCIATION' as const]) };
    expect(visibleLinks(edges, hidden).map((e) => e.target)).toEqual(['B']);
    expect(visibleLinks(edges, { nodes: new Set(['D']), relTypes: new Set() }).map((e) => e.target)).toEqual(['B', 'C', 'pkg:P']);
  });

  it('con relatedNext, una clase enlazada solo con un paquete plegado llega a su tarjeta agregada', () => {
    const boxes = [box('A', 0, 0), box('pkg:P', 200, 0)];
    expect(relatedNext(boxes, visibleLinks(edges, null), 'A', null, 'right')).toBe('pkg:P');
  });
});
