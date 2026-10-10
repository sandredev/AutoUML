// src/render/layout/aggregate.ts — paquetes plegados como un único nodo del layout (puro).
// El modelo agregado viaja al Worker: el layout coloca el paquete como una tarjeta más y rutea
// las aristas entre paquetes de verdad (sin reutilizar los codos del layout desplegado).
import type { DiagramModel, PackageModel, RelationshipModel, TypeNode } from '../../core/model';
import type { TextMeasurer } from '../style/contract';

/** Prefijo de los ids de los nodos que representan un paquete plegado. */
export const PACKAGE_NODE_PREFIX = '\u0000package:';
export const COLLAPSED_NODE_HEIGHT = 48;
export const COLLAPSED_NODE_MIN_W = 190;
export const COLLAPSED_NODE_MAX_W = 280;

export function isPackageNode(id: string): boolean {
  return id.startsWith(PACKAGE_NODE_PREFIX);
}

export function packageNodeName(id: string): string {
  return id.slice(PACKAGE_NODE_PREFIX.length);
}

/** Tamaño de la tarjeta de un paquete plegado (el nombre se recorta con "…" si no cabe). */
export function collapsedNodeSize(name: string, m: TextMeasurer): { w: number; h: number } {
  const w = Math.ceil(m(name, 'name') + 40);
  return { w: Math.min(COLLAPSED_NODE_MAX_W, Math.max(COLLAPSED_NODE_MIN_W, w)), h: COLLAPSED_NODE_HEIGHT };
}

export interface Aggregated {
  model: DiagramModel;
  /** Nombre de paquete plegado → número de entidades que contiene. */
  counts: Map<string, number>;
}

/** Clave estable del conjunto de paquetes plegados (para la caché de layouts). */
export function collapsedKey(collapsed: ReadonlySet<string>): string {
  return [...collapsed].sort().join('\n');
}

/** Paquete plegado que contiene a `pkg` (el más externo), o null. */
export function collapsedOwner(pkg: string, collapsed: ReadonlySet<string>): string | null {
  let best: string | null = null;
  for (const c of collapsed) {
    if ((pkg === c || pkg.startsWith(c + '.')) && (best === null || c.length < best.length)) best = c;
  }
  return best;
}

/** TypeNode sintético COMPLETO (sin casts): el layout lo mide y lo trata como cualquier otro tipo. */
function packageNode(name: string, line: number): TypeNode {
  return {
    id: PACKAGE_NODE_PREFIX + name,
    name,
    packageName: '',
    declaredKind: 'class',
    category: 'class',
    isAbstract: false,
    isSealed: false,
    isExternal: false,
    implicit: false,
    stereotypes: [],
    attributes: [],
    methods: [],
    constructors: [],
    enumConstants: [],
    line,
  };
}

/** Paquetes de un modelo indexados por los paquetes que los contienen (por nombre completo o capa). */
function ownerOfPackage(p: PackageModel, collapsed: ReadonlySet<string>): string | null {
  const own = collapsedOwner(p.name, collapsed);
  if (own !== null) return own;
  return p.layer !== undefined ? collapsedOwner(p.layer, collapsed) : null;
}

/**
 * Sustituye los tipos de cada paquete plegado por un nodo de paquete y agrega sus aristas:
 * misma pareja de extremos + mismo tipo ⇒ una sola arista con el contador "×n" como etiqueta.
 * Las aristas internas del paquete desaparecen. Sin paquetes plegados devuelve el mismo modelo.
 */
export function aggregateCollapsed(model: DiagramModel, collapsed: ReadonlySet<string>): Aggregated {
  const counts = new Map<string, number>();
  if (collapsed.size === 0) return { model, counts };

  // Dueño por tipo: por su paquete o por la capa que contiene a su paquete.
  const ownerByPackage = new Map<string, string | null>();
  for (const p of model.packages) ownerByPackage.set(p.name, ownerOfPackage(p, collapsed));
  const ownerOf = (pkg: string): string | null => ownerByPackage.get(pkg) ?? collapsedOwner(pkg, collapsed);

  const remap = new Map<string, string>();
  const types: TypeNode[] = [];
  const firstLine = new Map<string, number>();
  for (const t of model.types) {
    const owner = t.packageName ? ownerOf(t.packageName) : null;
    if (owner === null) {
      types.push(t);
      continue;
    }
    remap.set(t.id, PACKAGE_NODE_PREFIX + owner);
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
    if (!firstLine.has(owner)) firstLine.set(owner, t.line);
  }
  if (counts.size === 0) return { model, counts };
  for (const name of counts.keys()) types.push(packageNode(name, firstLine.get(name) ?? 0));

  const groups = new Map<string, { rel: RelationshipModel; n: number }>();
  let solo = 0;
  for (const r of model.relationships) {
    const source = remap.get(r.source) ?? r.source;
    const target = remap.get(r.target) ?? r.target;
    const touched = source !== r.source || target !== r.target;
    if (touched && source === target) continue; // arista interna del paquete plegado
    const key = touched ? `${source}\u0001${target}\u0001${r.type}` : `\u0002${solo++}`;
    const g = groups.get(key);
    if (g) g.n++;
    else groups.set(key, { rel: touched ? { ...r, source, target } : r, n: 1 });
  }
  const relationships: RelationshipModel[] = [];
  for (const { rel, n } of groups.values()) {
    if (n === 1) {
      relationships.push(rel);
      continue;
    }
    // Varias relaciones juntas: las multiplicidades y miembros de una sola ya no significan nada.
    const agg: RelationshipModel = { ...rel, label: `×${n}` };
    delete agg.sourceLabel;
    delete agg.targetLabel;
    delete agg.labelArrow;
    delete agg.sourceMember;
    delete agg.targetMember;
    delete agg.associationClass;
    relationships.push(agg);
  }

  const packages = model.packages.filter((p) => ownerOfPackage(p, collapsed) === null);
  const notes = (model.notes ?? []).map((n) => {
    const to = n.anchor !== undefined ? remap.get(n.anchor) : undefined;
    return to !== undefined ? { ...n, anchor: to } : n;
  });
  return { model: { ...model, types, relationships, packages, notes }, counts };
}
