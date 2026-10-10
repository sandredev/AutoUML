import { describe, expect, it } from 'vitest';
import type { TextMeasurer } from '../style/contract';
import { diagram, typeNode } from '../testModel';
import type { LayoutResult } from '../types';
import { measureNote, overlaps, placeNotes } from './notes';

/** Medidor determinista: 6 unidades por carácter. */
const m: TextMeasurer = (text) => text.length * 6;

const layout: LayoutResult = {
  nodes: [
    { id: 'A', x: 0, y: 0, w: 150, h: 60 },
    { id: 'B', x: 200, y: 0, w: 150, h: 60 },
  ],
  edges: [],
  packages: [],
  bounds: { x: 0, y: 0, w: 350, h: 60 },
};

describe('notas (T4)', () => {
  it('parte por "\\n" literal o real y ajusta por palabras al ancho máximo', () => {
    const r = measureNote('uno\\ndos\ntres', m);
    expect(r.lines).toEqual(['uno', 'dos', 'tres']);
    const long = measureNote('palabra '.repeat(20).trim(), m);
    expect(long.lines.length).toBeGreaterThan(1);
    expect(long.w).toBeLessThanOrEqual(260);
  });

  it('sin notas devuelve el mismo layout', () => {
    expect(placeNotes(diagram([typeNode('A')]), layout, m)).toBe(layout);
  });

  it('coloca las notas sin solaparse con tarjetas ni entre sí y respeta position', () => {
    const model = diagram([typeNode('A'), typeNode('B')], [], {
      notes: [
        { id: 'n1', text: 'a la derecha de A', anchor: 'A', position: 'right', line: 1 },
        { id: 'n2', text: 'otra a la derecha', anchor: 'A', position: 'right', line: 2 },
        { id: 'n3', text: 'encima', anchor: 'B', position: 'top', line: 3 },
        { id: 'n4', text: 'suelta', line: 4 },
      ],
    });
    const out = placeNotes(model, layout, m);
    const notes = out.notes ?? [];
    expect(notes).toHaveLength(4);
    const boxes = [...layout.nodes, ...notes];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!, 0)).toBe(false);
    }
    const n3 = notes.find((n) => n.id === 'n3')!;
    expect(n3.y + n3.h).toBeLessThanOrEqual(0);
    expect(n3.anchor).toBe('B');
    const n4 = notes.find((n) => n.id === 'n4')!;
    expect(n4.anchor).toBeUndefined();
    expect(n4.y).toBeGreaterThan(60);
    // bounds crece para incluir las notas
    expect(out.bounds.y).toBeLessThanOrEqual(n3.y);
    expect(out.bounds.y + out.bounds.h).toBeGreaterThanOrEqual(n4.y + n4.h);
  });
});
