// src/render/viewOptions.ts — estado del panel Vista (puro): valores por defecto, saneado, persistencia y conexión.
// El dibujo actual construye filas siempre con DEFAULT_DETAIL; para no desalinear filas medidas y pintadas,
// el filtrado de miembros se aplica al MODELO (applyViewOptions) y layout y dibujo reciben el mismo modelo y el mismo detail.
import type { DiagramModel, TypeNode } from '../core/model';
import { DEFAULT_DETAIL, type DetailOptions } from './style/contract';
import type { LayoutOptions } from './types';

export type SummaryMode = 'auto' | 'compact' | 'full';
export type LayoutDirection = 'TB' | 'LR';

export interface ViewOptions {
  summary: SummaryMode;
  direction: LayoutDirection;
  hideConstructors: boolean;
  hideAccessors: boolean;
}

export const DEFAULT_VIEW_OPTIONS: ViewOptions = {
  summary: 'auto',
  direction: 'TB',
  hideConstructors: false,
  hideAccessors: false,
};

export const viewOptionsStorageKey = 'autouml.viewOptions.v1';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function sanitizeViewOptions(raw: unknown): ViewOptions {
  if (!isRecord(raw)) return { ...DEFAULT_VIEW_OPTIONS };
  const s = raw.summary;
  const d = raw.direction;
  return {
    summary: s === 'auto' || s === 'compact' || s === 'full' ? s : DEFAULT_VIEW_OPTIONS.summary,
    direction: d === 'TB' || d === 'LR' ? d : DEFAULT_VIEW_OPTIONS.direction,
    hideConstructors: typeof raw.hideConstructors === 'boolean' ? raw.hideConstructors : DEFAULT_VIEW_OPTIONS.hideConstructors,
    hideAccessors: typeof raw.hideAccessors === 'boolean' ? raw.hideAccessors : DEFAULT_VIEW_OPTIONS.hideAccessors,
  };
}

function defaultStorage(): KeyValueStorage | null {
  try {
    const g = globalThis as { localStorage?: KeyValueStorage };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadViewOptions(storage: KeyValueStorage | null = defaultStorage()): ViewOptions {
  if (!storage) return { ...DEFAULT_VIEW_OPTIONS };
  try {
    const txt = storage.getItem(viewOptionsStorageKey);
    return sanitizeViewOptions(txt ? (JSON.parse(txt) as unknown) : null);
  } catch {
    return { ...DEFAULT_VIEW_OPTIONS };
  }
}

export function saveViewOptions(o: ViewOptions, storage: KeyValueStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(viewOptionsStorageKey, JSON.stringify(sanitizeViewOptions(o)));
  } catch {
    // almacenamiento lleno o no disponible: se ignora
  }
}

export function sameViewOptions(a: ViewOptions, b: ViewOptions): boolean {
  return a.summary === b.summary && a.direction === b.direction && a.hideConstructors === b.hideConstructors && a.hideAccessors === b.hideAccessors;
}

// Único detail compartido por layout y dibujo (el dibujo actual usa DEFAULT_DETAIL).
export function toDetail(): DetailOptions {
  return DEFAULT_DETAIL;
}

export function effectiveSummary(o: ViewOptions, model: DiagramModel): boolean {
  if (o.summary === 'compact') return true;
  if (o.summary === 'full') return false;
  return model.summaryMode;
}

export function toLayoutOptions(o: ViewOptions, model: DiagramModel): LayoutOptions {
  return { direction: o.direction, detail: toDetail(), summary: effectiveSummary(o, model) };
}

function isAccessorOf(name: string, attrs: Set<string>): boolean {
  const hit = /^(get|set|is)(.+)$/.exec(name);
  const prop = hit?.[2];
  return prop !== undefined && attrs.has(prop.toLowerCase());
}

function filterType(t: TypeNode, o: ViewOptions): TypeNode {
  if (!o.hideConstructors && !o.hideAccessors) return t;
  const attrs = new Set(t.attributes.map((a) => a.name.toLowerCase()));
  return {
    ...t,
    constructors: o.hideConstructors ? [] : t.constructors,
    methods: o.hideAccessors ? t.methods.filter((m) => !isAccessorOf(m.name, attrs)) : t.methods,
  };
}

// Modelo que reciben TANTO el layout como el dibujo. Devuelve el mismo objeto si no hay cambios.
export function applyViewOptions(model: DiagramModel, o: ViewOptions): DiagramModel {
  const summaryMode = effectiveSummary(o, model);
  const filter = o.hideConstructors || o.hideAccessors;
  if (!filter && summaryMode === model.summaryMode) return model;
  return {
    ...model,
    summaryMode,
    types: filter ? model.types.map((t) => filterType(t, o)) : model.types,
  };
}
