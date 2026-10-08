// src/render/canvas/overrides.ts — posiciones y paquetes fijados por el usuario (puro).
import type { DiagramModel } from '../../core/model';
import type { LayoutResult } from '../types';
import { rebuildLayout } from './dragNode';

export interface NodeOverride {
  x: number;
  y: number;
  packageName?: string;
}

export interface LayoutOverrides {
  version: 1;
  nodes: Record<string, NodeOverride>;
}

export function emptyOverrides(): LayoutOverrides {
  return { version: 1, nodes: {} };
}

export function hasOverrides(o: LayoutOverrides): boolean {
  return Object.keys(o.nodes).length > 0;
}

// Firma estable del modelo (FNV-1a sobre ids y paquetes) para la clave de persistencia.
export function modelSignature(model: DiagramModel): string {
  const parts = model.types.map((t) => t.id + '@' + t.packageName).sort();
  let h = 0x811c9dc5;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) {
      h ^= p.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 10;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + '-' + String(parts.length);
}

export function storageKeyFor(model: DiagramModel): string {
  return 'autouml.layout.' + modelSignature(model);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseOverrides(text: string | null | undefined): LayoutOverrides {
  if (!text) return emptyOverrides();
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return emptyOverrides();
  }
  if (typeof raw !== 'object' || raw === null) return emptyOverrides();
  const r = raw as { version?: unknown; nodes?: unknown };
  if (r.version !== 1 || typeof r.nodes !== 'object' || r.nodes === null) return emptyOverrides();
  const out = emptyOverrides();
  for (const [id, v] of Object.entries(r.nodes as Record<string, unknown>)) {
    if (typeof v !== 'object' || v === null) continue;
    const o = v as { x?: unknown; y?: unknown; packageName?: unknown };
    if (!isNum(o.x) || !isNum(o.y)) continue;
    const entry: NodeOverride = { x: o.x, y: o.y };
    if (typeof o.packageName === 'string' && o.packageName.length > 0) entry.packageName = o.packageName;
    out.nodes[id] = entry;
  }
  return out;
}

export function serializeOverrides(o: LayoutOverrides): string {
  return JSON.stringify(o);
}

export function basePackageOf(model: DiagramModel): Map<string, string> {
  return new Map(model.types.map((t) => [t.id, t.packageName]));
}

// Descarta entidades o paquetes que ya no existen en el modelo.
export function pruneOverrides(model: DiagramModel, o: LayoutOverrides): LayoutOverrides {
  const ids = new Set(model.types.map((t) => t.id));
  const pkgs = new Set(model.packages.map((p) => p.name));
  const out = emptyOverrides();
  for (const [id, v] of Object.entries(o.nodes)) {
    if (!ids.has(id)) continue;
    const entry: NodeOverride = { x: v.x, y: v.y };
    if (v.packageName !== undefined && pkgs.has(v.packageName)) entry.packageName = v.packageName;
    out.nodes[id] = entry;
  }
  return out;
}

// Aplica las fijaciones sobre el layout automático y reconstruye paquetes y aristas afectadas.
export function applyOverrides(model: DiagramModel, layout: LayoutResult, o: LayoutOverrides): LayoutResult {
  const base = basePackageOf(model);
  const named = layout.nodes.map((n) => {
    const pkg = n.packageName ?? base.get(n.id);
    return pkg === undefined || pkg === n.packageName ? n : { ...n, packageName: pkg };
  });
  const start: LayoutResult = { ...layout, nodes: named };
  if (!hasOverrides(o)) return start;
  const nodes = named.map((n) => {
    const ov = o.nodes[n.id];
    if (!ov) return n;
    const next = { ...n, x: ov.x, y: ov.y };
    if (ov.packageName !== undefined) next.packageName = ov.packageName;
    return next;
  });
  return rebuildLayout(start, nodes);
}

// Fijaciones = diferencias entre el layout final y el automático.
export function diffOverrides(model: DiagramModel, base: LayoutResult, final: LayoutResult): LayoutOverrides {
  const pkgOf = basePackageOf(model);
  const bm = new Map(base.nodes.map((n) => [n.id, n]));
  const out = emptyOverrides();
  for (const n of final.nodes) {
    const b = bm.get(n.id);
    if (!b) continue;
    const origPkg = b.packageName ?? pkgOf.get(n.id);
    const movedPos = Math.abs(b.x - n.x) > 0.5 || Math.abs(b.y - n.y) > 0.5;
    const movedPkg = n.packageName !== undefined && n.packageName !== origPkg;
    if (!movedPos && !movedPkg) continue;
    const entry: NodeOverride = { x: n.x, y: n.y };
    if (movedPkg && n.packageName !== undefined) entry.packageName = n.packageName;
    out.nodes[n.id] = entry;
  }
  return out;
}
