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

/**
 * Actualiza la ruta del paquete en el documento PlantUML tras hacer Drag & Drop
 * de un paquete dentro de otro paquete.
 */
export function syncNestedPackageInPuml(
  pumlContent: string,
  oldPackagePath: string,
  newPackagePath: string
): string {
  const escapedOld = oldPackagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const qualifiedRegex = new RegExp(
    `(\\b(?:package|namespace)\\s+"?)${escapedOld}(\\.[^"\\s{]+)?("?\\s*(?:as\\s+\\w+\\s*)?\\{?)`,
    'g'
  );

  let updated = pumlContent.replace(qualifiedRegex, (_m, prefix, sub = '', suffix) => {
    return `${prefix}${newPackagePath}${sub}${suffix}`;
  });

  if (updated === pumlContent) {
    const shortName = oldPackagePath.split('.').pop()!;
    const simpleRegex = new RegExp(
      `(\\b(?:package|namespace)\\s+"?)${shortName}("?\\s*(?:as\\s+\\w+\\s*)?\\{)`,
      'g'
    );
    updated = pumlContent.replace(simpleRegex, `$1${newPackagePath}$2`);
  }

  return updated;
}

/**
 * Actualiza el extremo origen o destino de una relación en el código PlantUML.
 */
export function syncReconnectedRelationInPuml(
  pumlContent: string,
  oldSource: string,
  oldTarget: string,
  newSource: string,
  newTarget: string
): string {
  const lines = pumlContent.split(/\r?\n/);
  const escSrc = oldSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escTgt = oldTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const relRegex = new RegExp(
    `^(\\s*"?${escSrc}"?\\s+)([<|*o#x+^-]*[-.~]+.*[>|*o#x+^-]*)(\\s+"?${escTgt}"?.*)$`
  );

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith("'")) continue;
    const match = lines[i].match(relRegex);
    if (match) {
      lines[i] = `${match[1].replace(oldSource, newSource)}${match[2]}${match[3].replace(
        oldTarget,
        newTarget
      )}`;
      break;
    }
  }
  return lines.join('\n');
}

/**
 * Elimina del código PlantUML las relaciones cortadas con la cuchilla o desconectadas.
 */
export function syncBrokenRelationsInPuml(
  pumlContent: string,
  brokenEdges: Array<{ source: string; target: string }>
): string {
  if (brokenEdges.length === 0) return pumlContent;
  const lines = pumlContent.split(/\r?\n/);

  return lines
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("'")) return true;
      for (const rel of brokenEdges) {
        const s = rel.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const t = rel.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const fwd = new RegExp(`^"?${s}"?\\s+[<|*o#x+^-]*[-.~]+.*[>|*o#x+^-]*\\s+"?${t}"?(?:\\s*:.*)?$`);
        const rev = new RegExp(`^"?${t}"?\\s+[<|*o#x+^-]*[-.~]+.*[>|*o#x+^-]*\\s+"?${s}"?(?:\\s*:.*)?$`);
        if (fwd.test(trimmed) || rev.test(trimmed)) return false;
      }
      return true;
    })
    .join('\n');
}
