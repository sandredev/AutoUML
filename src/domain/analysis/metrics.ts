// src/domain/analysis/metrics.ts — métricas descriptivas del diagrama (T9). Puro.
import type { Category, DiagramModel } from '../diagram/model';
import { stronglyConnected } from './cycles';
import { byId, digraphOf, isAnalyzedType, type AnalysisOptions } from './graph';

/** Tipos del modelo por categoría (todos, también externos y sin declarar: es descriptivo). Solo las no vacías. */
export function categoryCounts(model: DiagramModel): Partial<Record<Category, number>> {
  const out: Partial<Record<Category, number>> = {};
  for (const t of model.types) out[t.category] = (out[t.category] ?? 0) + 1;
  return out;
}

export interface InheritanceDepth {
  /** Aristas de herencia de la cadena más larga (0 = sin herencia). */
  depth: number;
  /** La cadena, del tipo más profundo a la raíz (vacía si depth = 0). */
  chain: string[];
}

/**
 * Profundidad máxima de herencia: la cadena más larga de EXTENDS/IMPLEMENTS (hijo → padre) entre tipos
 * analizados. Un ciclo de herencia (inválido, pero el .puml puede traerlo) no cuelga el cálculo: se trabaja
 * sobre los componentes fuertemente conexos, y un ciclo cuenta como un solo nivel.
 */
export function inheritanceDepth(model: DiagramModel, opts: AnalysisOptions = {}): InheritanceDepth {
  const nodes = model.types.filter((t) => isAnalyzedType(t, opts)).map((t) => t.id);
  const pairs = model.relationships
    .filter((r) => (r.type === 'EXTENDS' || r.type === 'IMPLEMENTS') && r.associationClass === undefined)
    .map((r) => [r.source, r.target] as const);
  const g = digraphOf(nodes, pairs);
  // Tarjan emite los componentes en orden topológico inverso: cuando se procesa uno, todos los que
  // alcanza ya tienen su profundidad.
  const comps = stronglyConnected(g);
  const compOf = new Map<string, number>();
  comps.forEach((c, i) => c.forEach((id) => compOf.set(id, i)));
  const depth: number[] = [];
  const via: Array<[string, string] | null> = [];
  comps.forEach((members, i) => {
    let best = 0;
    let edge: [string, string] | null = null;
    for (const u of members) {
      for (const v of g.out.get(u) ?? []) {
        const j = compOf.get(v) as number;
        if (j === i) continue;
        const d = (depth[j] as number) + 1;
        if (d > best) {
          best = d;
          edge = [u, v];
        }
      }
    }
    depth[i] = best;
    via[i] = edge;
  });

  let top = -1;
  comps.forEach((members, i) => {
    const d = depth[i] as number;
    if (d === 0) return;
    const bestTop = top < 0 ? -1 : (depth[top] as number);
    if (d > bestTop || (d === bestTop && byId(members[0] as string, (comps[top] as string[])[0] as string) < 0)) top = i;
  });
  if (top < 0) return { depth: 0, chain: [] };

  // Se recorre la cadena: [u, v] de cada salto; dentro de un ciclo puede saltar entre miembros.
  const chain: string[] = [];
  for (let i: number | undefined = top; i !== undefined; ) {
    const e = via[i];
    if (!e) break;
    if (chain[chain.length - 1] !== e[0]) chain.push(e[0]);
    chain.push(e[1]);
    i = compOf.get(e[1]);
  }
  return { depth: depth[top] as number, chain };
}
