// Sincronización texto ↔ diagrama del editor en vivo (T7). Módulo puro: sin React, sin DOM.
// Las líneas del modelo son las del texto combinado (con !include expandidos); el editor muestra
// solo el archivo de entrada: lineMapping traduce entre las dos numeraciones.
import type { DiagramModel } from '../../domain/diagram/model';
import type { PumlLineRef } from '../ports/ipc';

/** Lo que hay en una línea del texto: un tipo (su cuerpo entero) o una relación. */
export type SourceElement = { kind: 'type'; id: string } | { kind: 'relation'; line: number };

export interface LineRange {
  line: number;
  endLine: number;
}

export interface SourceIndex {
  /** Elemento al que pertenece la línea (1-based, numeración del modelo); null si ninguno. */
  elementAt(line: number): SourceElement | null;
  /** Rango de la declaración de un tipo; el de un implícito es la relación que lo nombró. */
  rangeOf(id: string): LineRange | null;
}

/** Índice línea ↔ elemento de un modelo. Se construye una vez por modelo; las consultas no lo recorren entero. */
export function createSourceIndex(model: DiagramModel): SourceIndex {
  const ranges = new Map<string, LineRange>();
  // Tipos declarados ordenados por inicio; los implícitos no ocupan líneas propias.
  const declared: { id: string; line: number; endLine: number }[] = [];
  for (const t of model.types) {
    const range = { line: t.line, endLine: Math.max(t.line, t.endLine ?? t.line) };
    ranges.set(t.id, range);
    if (!t.implicit) declared.push({ id: t.id, ...range });
  }
  declared.sort((a, b) => a.line - b.line);
  const relationLines = new Set(model.relationships.map((r) => r.line));

  return {
    elementAt(line) {
      // El tipo más interno que contiene la línea (el de inicio más tardío entre los que la abarcan).
      let hit: string | null = null;
      for (const d of declared) {
        if (d.line > line) break;
        if (line <= d.endLine) hit = d.id;
      }
      if (hit !== null) return { kind: 'type', id: hit };
      return relationLines.has(line) ? { kind: 'relation', line } : null;
    },
    rangeOf(id) {
      return ranges.get(id) ?? null;
    },
  };
}

export interface LineMapping {
  /** Línea del texto combinado → línea del archivo de entrada; null si viene de un incluido. */
  toEntry(combinedLine: number): number | null;
  /** Línea del archivo de entrada → línea combinada; null si no llega al combinado (p. ej. un !include). */
  toCombined(entryLine: number): number | null;
}

const IDENTITY: LineMapping = {
  toEntry: (line) => line,
  toCombined: (line) => line,
};

/** Traducción de líneas a partir del lineMap de la carga. Sin mapa (sin !include) es la identidad. */
export function lineMapping(lineMap: readonly PumlLineRef[] | null, entryPath: string | null): LineMapping {
  if (lineMap === null || entryPath === null) return IDENTITY;
  const toEntry: (number | null)[] = [];
  const toCombined = new Map<number, number>();
  lineMap.forEach((ref, idx) => {
    const own = ref.file === entryPath;
    toEntry.push(own ? ref.line : null);
    if (own && !toCombined.has(ref.line)) toCombined.set(ref.line, idx + 1);
  });
  return {
    toEntry: (line) => toEntry[line - 1] ?? null,
    toCombined: (line) => toCombined.get(line) ?? null,
  };
}
