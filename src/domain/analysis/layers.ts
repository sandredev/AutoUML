// src/domain/analysis/layers.ts — capas y violaciones de capas (T9). Puro.
//
// Dirección: la PRIMERA capa de la lista es la SUPERIOR (p. ej. ui, app, domain). Una capa superior puede
// depender de una inferior; la violación es la dependencia HACIA ARRIBA: origen en una capa de índice mayor
// que el destino. Dentro de la misma capa no hay violación, y un tipo sin capa no participa.
//
// Orden de las capas: el de `layers.json` del proyecto si trae alguna; si no, el orden de aparición de
// `PackageModel.layer` (paquetes anidados bajo un paquete-capa del generador).
//
// Un tipo pertenece a la capa L si el `layer` de su paquete es L, o si su paquete es L o empieza por "L.".
// Si encajan varias gana la más específica: primero el campo `layer`, luego el nombre más largo.
import type { DiagramModel } from '../diagram/model';
import type { Digraph } from './graph';
import { byId } from './graph';

export interface LayerSpec {
  /** Capas de arriba abajo. */
  order: string[];
  /** De dónde sale el orden. */
  source: 'config' | 'model' | 'none';
}

export interface LayerViolation {
  source: string;
  target: string;
  /** Índices en `LayerSpec.order` (sourceLayer > targetLayer). */
  sourceLayer: number;
  targetLayer: number;
}

export function resolveLayers(model: DiagramModel, configured?: readonly string[] | null): LayerSpec {
  if (configured && configured.length > 0) return { order: [...configured], source: 'config' };
  const order: string[] = [];
  for (const p of model.packages) if (p.layer !== undefined && !order.includes(p.layer)) order.push(p.layer);
  return { order, source: order.length > 0 ? 'model' : 'none' };
}

/** Tipo → índice de su capa (los tipos sin capa no aparecen). */
export function layerIndexOf(model: DiagramModel, order: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (order.length === 0) return out;
  const layerOfPkg = new Map(model.packages.map((p) => [p.name, p.layer]));
  const memo = new Map<string, number>();
  const indexFor = (pkg: string): number => {
    const hit = memo.get(pkg);
    if (hit !== undefined) return hit;
    const declared = layerOfPkg.get(pkg);
    let best = -1;
    let bestScore = -1;
    order.forEach((name, i) => {
      const score = declared === name ? Number.MAX_SAFE_INTEGER : pkg === name || pkg.startsWith(`${name}.`) ? name.length : -1;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    memo.set(pkg, best);
    return best;
  };
  for (const t of model.types) {
    const i = indexFor(t.packageName);
    if (i >= 0) out.set(t.id, i);
  }
  return out;
}

/** Dependencias hacia arriba, ordenadas por origen y destino. */
export function findLayerViolations(g: Digraph, layerOf: ReadonlyMap<string, number>): LayerViolation[] {
  const out: LayerViolation[] = [];
  for (const source of g.nodes) {
    const sl = layerOf.get(source);
    if (sl === undefined) continue;
    for (const target of g.out.get(source) ?? []) {
      const tl = layerOf.get(target);
      if (tl !== undefined && sl > tl) out.push({ source, target, sourceLayer: sl, targetLayer: tl });
    }
  }
  return out.sort((a, b) => byId(a.source, b.source) || byId(a.target, b.target));
}
