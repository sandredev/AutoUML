// src/domain/analysis/coupling.ts — métricas de acoplamiento de Robert C. Martin (T9). Puro.
//
// Terminología (cuidado: es fácil cruzarlas):
//   Ca = acoplamiento AFERENTE = dependencias ENTRANTES = cuántas clases me usan.
//   Ce = acoplamiento EFERENTE = dependencias SALIENTES = cuántas clases uso.
//   I  = Ce / (Ca + Ce), inestabilidad en [0, 1]; I = 0 si Ca + Ce = 0 (una clase aislada no es inestable).
// Se cuentan CLASES distintas, no relaciones: el Digraph ya viene deduplicado y sin autorreferencias.
//
// Por paquete (definición de Martin):
//   Ca(P) = clases de FUERA de P que dependen de alguna clase de P.
//   Ce(P) = clases de DENTRO de P que dependen de alguna clase de fuera de P.
//   A(P)  = tipos abstractos (interfaces y clases abstractas) / tipos de P.
//   D(P)  = |A + I − 1|, distancia a la "secuencia principal" (0 = equilibrado).
import type { DiagramModel, TypeNode } from '../diagram/model';
import { byId, type Digraph } from './graph';

export interface ClassCoupling {
  ca: number;
  ce: number;
  instability: number;
}

export interface CoupledClass extends ClassCoupling {
  id: string;
}

export interface PackageMetrics {
  name: string;
  /** Tipos analizados del paquete. */
  types: number;
  abstractTypes: number;
  ca: number;
  ce: number;
  instability: number;
  abstractness: number;
  distance: number;
}

export function instabilityOf(ca: number, ce: number): number {
  return ca + ce === 0 ? 0 : ce / (ca + ce);
}

export function isAbstractType(t: TypeNode): boolean {
  return t.isAbstract || t.declaredKind === 'interface' || t.category === 'interface' || t.category === 'abstract';
}

export function classCoupling(g: Digraph): Map<string, ClassCoupling> {
  const out = new Map<string, ClassCoupling>();
  for (const id of g.nodes) {
    const ca = g.in.get(id)?.length ?? 0;
    const ce = g.out.get(id)?.length ?? 0;
    out.set(id, { ca, ce, instability: instabilityOf(ca, ce) });
  }
  return out;
}

/** Las `n` clases con más acoplamiento total (Ca + Ce); empate por id. Las de acoplamiento 0 no entran. */
export function topCoupled(coupling: ReadonlyMap<string, ClassCoupling>, n: number): CoupledClass[] {
  return [...coupling]
    .filter(([, c]) => c.ca + c.ce > 0)
    .map(([id, c]) => ({ id, ...c }))
    .sort((a, b) => b.ca + b.ce - (a.ca + a.ce) || byId(a.id, b.id))
    .slice(0, n);
}

export function packageMetrics(model: DiagramModel, g: Digraph): PackageMetrics[] {
  const byType = new Map(model.types.map((t) => [t.id, t]));
  const pkgOf = (id: string): string => (byType.get(id) as TypeNode).packageName;
  const acc = new Map<string, { types: number; abstractTypes: number; ca: Set<string>; ce: Set<string> }>();
  const get = (name: string) => {
    let a = acc.get(name);
    if (!a) acc.set(name, (a = { types: 0, abstractTypes: 0, ca: new Set(), ce: new Set() }));
    return a;
  };
  for (const id of g.nodes) {
    const a = get(pkgOf(id));
    a.types++;
    if (isAbstractType(byType.get(id) as TypeNode)) a.abstractTypes++;
  }
  for (const [src, succ] of g.out) {
    const ps = pkgOf(src);
    for (const dst of succ) {
      const pd = pkgOf(dst);
      if (ps === pd) continue;
      get(ps).ce.add(src); // src (dentro de ps) depende de fuera
      get(pd).ca.add(src); // src (fuera de pd) depende de pd
    }
  }
  return [...acc]
    .sort(([a], [b]) => byId(a, b))
    .map(([name, a]) => {
      const instability = instabilityOf(a.ca.size, a.ce.size);
      const abstractness = a.types === 0 ? 0 : a.abstractTypes / a.types;
      return {
        name,
        types: a.types,
        abstractTypes: a.abstractTypes,
        ca: a.ca.size,
        ce: a.ce.size,
        instability,
        abstractness,
        distance: Math.abs(abstractness + instability - 1),
      };
    });
}
