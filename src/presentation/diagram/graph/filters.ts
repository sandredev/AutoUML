// src/presentation/diagram/graph/filters.ts — filtros semánticos del visor (puro, T8).
// Dos clases de filtro:
//  - De TAMAÑO (visibilidad mínima, getters/setters, constructores): quitan miembros, así que cambian lo que
//    mide cada tarjeta. Se aplican al MODELO aguas arriba del layout y su clave entra en la caché: recalculan.
//  - De DIBUJO (tipos de relación, externos, sin declarar, paquetes, clases sueltas): no tocan el layout; se
//    quitan nodos y aristas del layout ya calculado antes de dibujar, así que nada se mueve al activarlos.
import type { SidecarFilters } from '../../../application/ports/ipc';
import type { DiagramModel, RelType, TypeNode, Visibility } from '../../../domain/diagram/model';
import { ACCESSOR_RE } from '../layout/cardModel';
import { isPackageNode, packageNodeName } from '../layout/aggregate';
import type { LayoutResult } from '../types';

export type DiagramFilters = SidecarFilters;

/** Cuánto se ve un miembro: público > protegido > paquete > privado. */
const RANK: Record<Visibility, number> = { '+': 3, '#': 2, '~': 1, '-': 0 };

/** Visibilidad mínima efectiva ('-' = todos = sin filtro). */
const minRank = (f: DiagramFilters): number => (f.minVisibility ? RANK[f.minVisibility] : 0);

/** Clave de los filtros que cambian el tamaño de las tarjetas ('' = ninguno). */
export function memberFiltersKey(f: DiagramFilters): string {
  const parts: string[] = [];
  if (minRank(f) > 0) parts.push('v' + f.minVisibility);
  if (f.hideAccessors) parts.push('acc');
  if (f.hideConstructors) parts.push('ctor');
  return parts.join(',');
}

/** true si pasar de `prev` a `next` obliga a recalcular el layout. */
export function needsRelayout(prev: DiagramFilters, next: DiagramFilters): boolean {
  return memberFiltersKey(prev) !== memberFiltersKey(next);
}

/** Cuántos filtros hay activos (cada casilla o lista no vacía cuenta uno), para el botón del panel. */
export function activeFilterCount(f: DiagramFilters): number {
  return [
    minRank(f) > 0,
    f.hideAccessors === true,
    f.hideConstructors === true,
    (f.hiddenRelTypes?.length ?? 0) > 0,
    f.hideExternal === true,
    f.hideUndeclared === true,
    (f.hiddenPackages?.length ?? 0) > 0,
    (f.hiddenTypes?.length ?? 0) > 0,
  ].filter(Boolean).length;
}

/** Hay algún filtro activo. */
export function hasActiveFilters(f: DiagramFilters): boolean {
  return activeFilterCount(f) > 0;
}

function filterType(t: TypeNode, rank: number, accessors: boolean, ctors: boolean): TypeNode {
  const attributes = rank > 0 ? t.attributes.filter((a) => RANK[a.visibility] >= rank) : t.attributes;
  const methods = rank > 0 || accessors
    ? t.methods.filter((m) => RANK[m.visibility] >= rank && !(accessors && ACCESSOR_RE.test(m.name)))
    : t.methods;
  const constructors = ctors ? [] : rank > 0 ? t.constructors.filter((c) => RANK[c.visibility] >= rank) : t.constructors;
  const same = attributes.length === t.attributes.length && methods.length === t.methods.length
    && constructors.length === t.constructors.length;
  return same ? t : { ...t, attributes, methods, constructors };
}

/** Quita los miembros filtrados. Sin filtros de tamaño (o si nada cambia) devuelve el MISMO modelo. */
export function applyMemberFilters(model: DiagramModel, f: DiagramFilters): DiagramModel {
  if (memberFiltersKey(f) === '') return model;
  const rank = minRank(f);
  const accessors = f.hideAccessors === true;
  const ctors = f.hideConstructors === true;
  let changed = false;
  const types = model.types.map((t) => {
    const next = filterType(t, rank, accessors, ctors);
    if (next !== t) changed = true;
    return next;
  });
  return changed ? { ...model, types } : model;
}

export interface DrawHidden {
  nodes: ReadonlySet<string>;
  relTypes: ReadonlySet<RelType>;
}

/**
 * Qué no se dibuja del modelo mostrado (agregado/enfocado): tipos externos, sin declarar, de paquetes
 * desmarcados u ocultados a mano, y tipos de relación. null si no hay filtros de dibujo.
 */
export function drawHiddenOf(model: DiagramModel, f: DiagramFilters): DrawHidden | null {
  const pkgs = new Set(f.hiddenPackages ?? []);
  const types = new Set(f.hiddenTypes ?? []);
  const relTypes = new Set<RelType>(f.hiddenRelTypes ?? []);
  if (!f.hideExternal && !f.hideUndeclared && pkgs.size === 0 && types.size === 0 && relTypes.size === 0) return null;
  const nodes = new Set<string>();
  for (const t of model.types) {
    const hidden = isPackageNode(t.id)
      ? pkgs.has(packageNodeName(t.id))
      : types.has(t.id)
        || pkgs.has(t.packageName)
        || (f.hideExternal === true && t.category === 'external')
        || (f.hideUndeclared === true && t.category === 'undeclared');
    if (hidden) nodes.add(t.id);
  }
  return { nodes, relTypes };
}

/**
 * Layout sin lo oculto: nodos, aristas con un extremo oculto o de un tipo oculto, notas ancladas a nodos
 * ocultos y marcos de paquete que se quedan sin tipos visibles. Los bounds no cambian (la vista no salta).
 * Sin nada oculto devuelve el MISMO layout.
 */
export function filterLayout(layout: LayoutResult, model: DiagramModel, hidden: DrawHidden | null): LayoutResult {
  if (!hidden || (hidden.nodes.size === 0 && hidden.relTypes.size === 0)) return layout;
  const nodes = layout.nodes.filter((n) => !hidden.nodes.has(n.id));
  const visible = new Set(nodes.map((n) => n.id));
  const edges = layout.edges.filter((e) => !hidden.relTypes.has(e.type) && visible.has(e.source) && visible.has(e.target));
  const pkgTypes = new Map(model.packages.map((p) => [p.name, p.typeIds] as const));
  const packages = layout.packages.filter((p) => {
    const ids = pkgTypes.get(p.name);
    return ids === undefined || ids.length === 0 || ids.some((id) => visible.has(id));
  });
  const out: LayoutResult = { ...layout, nodes, edges, packages };
  if (layout.notes) out.notes = layout.notes.filter((n) => n.anchor === undefined || visible.has(n.anchor));
  return out;
}
