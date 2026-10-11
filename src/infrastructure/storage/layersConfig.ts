// Orden de capas del diagnóstico de arquitectura (T9): `layers.json` en la carpeta del proyecto o junto al .puml
// externo. Formato: { "layers": ["ui", "app", "domain"] } o la lista suelta; la PRIMERA es la capa superior.
// Cada nombre casa con el `layer` de un paquete o con un nombre/prefijo de paquete (ver domain/analysis/layers.ts).
// Módulo puro de main: sin Electron, testeable en Vitest. Solo lectura: la app nunca escribe este archivo.
import fs from 'node:fs';
import path from 'node:path';

export const LAYERS_FILE = 'layers.json';
const MAX_LAYERS = 200;
const MAX_NAME = 300;

export function layersPathForProject(projectDir: string): string {
  return path.join(projectDir, LAYERS_FILE);
}

export function layersPathForFile(pumlPath: string): string {
  return path.join(path.dirname(pumlPath), LAYERS_FILE);
}

/** Capas válidas (recortadas, sin vacíos ni repetidos) o null si el valor no describe capas. */
export function validateLayers(v: unknown): string[] | null {
  const list = Array.isArray(v)
    ? v
    : typeof v === 'object' && v !== null && Array.isArray((v as Record<string, unknown>).layers)
      ? ((v as Record<string, unknown>).layers as unknown[])
      : null;
  if (!list) return null;
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (name === '' || name.length > MAX_NAME || out.includes(name)) continue;
    out.push(name);
    if (out.length >= MAX_LAYERS) break;
  }
  return out.length > 0 ? out : null;
}

/** Ausente → sin capas ni aviso; roto o inválido → sin capas + corrupto (la app avisa y sigue con el modelo). */
export function readLayersFile(file: string): { layers: string[] | null; corrupt: boolean } {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { layers: null, corrupt: false };
  }
  try {
    const layers = validateLayers(JSON.parse(raw.replace(/^﻿/, '')) as unknown);
    return layers === null ? { layers: null, corrupt: true } : { layers, corrupt: false };
  } catch {
    return { layers: null, corrupt: true };
  }
}
