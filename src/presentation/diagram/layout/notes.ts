// src/presentation/diagram/layout/notes.ts — medida y colocación de notas estilo PlantUML (puro).
// Las notas se colocan sobre el layout ya calculado: junto a su clase según position, empujándolas
// hasta que no se solapan con tarjetas ni con otras notas. Las sueltas van en fila bajo el diagrama.
import type { DiagramModel } from '../../../domain/diagram/model';
import type { TextMeasurer } from '../style/contract';
import type { LayoutResult, NodeBox, NoteBox } from '../types';
import { makeMeasurer } from './cardModel';

export const NOTE = {
  gap: 24,
  lineH: 15,
  pad: 8,
  fold: 10,
  maxW: 260,
  minW: 60,
  step: 12,
  maxTries: 80,
} as const;

interface Rect { x: number; y: number; w: number; h: number }

let measurer: TextMeasurer | null = null;
const getMeasurer = (): TextMeasurer => (measurer ??= makeMeasurer());

export function overlaps(a: Rect, b: Rect, margin = 6): boolean {
  return a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;
}

/** Parte el texto en líneas ("\n" real o literal) y ajusta por palabras al ancho máximo. */
export function measureNote(text: string, m: TextMeasurer = getMeasurer()): { lines: string[]; w: number; h: number } {
  const inner = NOTE.maxW - 2 * NOTE.pad - NOTE.fold;
  const lines: string[] = [];
  for (const para of text.split(/\\n|\n/u)) {
    const words = para.trimEnd().split(/\s+/u).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (cur && m(next, 'row') > inner) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    lines.push(cur);
  }
  let longest = 0;
  for (const l of lines) longest = Math.max(longest, m(l, 'row'));
  const w = Math.min(NOTE.maxW, Math.max(NOTE.minW, Math.ceil(longest) + 2 * NOTE.pad + NOTE.fold));
  return { lines, w, h: lines.length * NOTE.lineH + 2 * NOTE.pad };
}

function firstSlot(anchor: NodeBox, pos: string, w: number, h: number): Rect {
  const g = NOTE.gap;
  if (pos === 'left') return { x: anchor.x - w - g, y: anchor.y, w, h };
  if (pos === 'top') return { x: anchor.x, y: anchor.y - h - g, w, h };
  if (pos === 'bottom') return { x: anchor.x, y: anchor.y + anchor.h + g, w, h };
  return { x: anchor.x + anchor.w + g, y: anchor.y, w, h };
}

/** Devuelve un layout nuevo con `notes` colocadas y bounds ampliado. Sin notas, el mismo layout. */
export function placeNotes(model: DiagramModel, layout: LayoutResult, m?: TextMeasurer): LayoutResult {
  const notes = model.notes ?? [];
  if (notes.length === 0 || layout.nodes.length === 0) return layout;
  const byId = new Map<string, NodeBox>(layout.nodes.map((n) => [n.id, n]));
  const obstacles: Rect[] = [...layout.nodes];
  const out: NoteBox[] = [];
  const b = layout.bounds;
  let freeX = b.x;
  const freeY = b.y + b.h + NOTE.gap;

  for (const n of notes) {
    const { lines, w, h } = measureNote(n.text, m);
    const anchor = n.anchor !== undefined ? byId.get(n.anchor) : undefined;
    let r: Rect;
    if (!anchor) {
      r = { x: freeX, y: freeY, w, h };
      freeX += w + NOTE.gap;
    } else {
      const pos = n.position ?? 'right';
      r = firstSlot(anchor, pos, w, h);
      // Izquierda/derecha: se desliza en vertical; arriba/abajo: en horizontal.
      const vertical = pos === 'left' || pos === 'right';
      for (let k = 0; k < NOTE.maxTries && obstacles.some((o) => overlaps(r, o)); k++) {
        if (vertical) r.y += NOTE.step;
        else r.x += NOTE.step;
      }
    }
    obstacles.push(r);
    const box: NoteBox = { id: n.id, ...r, lines };
    if (anchor) box.anchor = anchor.id;
    out.push(box);
  }

  let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
  for (const r of out) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { ...layout, notes: out, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}
