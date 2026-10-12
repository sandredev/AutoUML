// src/presentation/diagram/viewerInfo.ts — qué se ve del documento (puro, T11).
// Lo usan la lista de entidades (bloque "Fuera de la vista", ojo por entidad) y la barra de estado (conteos).
import type { DiagramModel, TypeNode } from '../../domain/diagram/model';
import type { DrawHidden } from './graph/filters';
import { applyHide, parseHide } from './graph/hide';
import { collapsedOwner, isPackageNode, packageNodeName } from './layout/aggregate';

/** Lo que el visor cuenta a la app tras cada cambio de vista. */
export interface ViewerInfo {
  totalTypes: number;
  shownTypes: number;
  totalRelations: number;
  shownRelations: number;
  /** Tipos del documento que no se dibujan (filtros, foco o `hide` del .puml). */
  outOfView: ReadonlySet<string>;
  /** Vista guardada aplicada y sin tocar desde entonces; null si no hay. */
  viewName: string | null;
  /** Hay filtros, foco o tipos ocultos a mano: el diagrama no está completo. */
  narrowed: boolean;
  /** Zoom actual en %. */
  zoom: number;
  /** Motivo si el layout cayó al motor simplificado; null si no. */
  fallback: string | null;
  /** Duración del último cálculo de la disposición (ms), para la información técnica. */
  layoutMs: number | null;
}

/** Mandos del visor que usa la app. */
export interface ViewerControl {
  /** Quita (false) o vuelve a poner (true) un tipo en la vista; devuelve false si no se puede (p. ej. `hide`). */
  setTypeVisible(id: string, visible: boolean): boolean;
  /** Quita filtros, foco y vista aplicada. */
  showAll(): void;
  /** Recalcula el layout desde cero (tras un fallo del motor). */
  retryLayout(): void;
}

/**
 * Tipos del documento que no se dibujan. `viewModel` es el modelo ya agregado/enfocado (con tarjetas de
 * paquete plegado) y `hidden` lo que los filtros de dibujo quitan de él. Los tipos dentro de un paquete
 * plegado SÍ cuentan como vistos: están en la tarjeta del paquete.
 */
export function outOfViewOf(
  model: DiagramModel,
  viewModel: DiagramModel,
  hidden: DrawHidden | null,
  collapsed: ReadonlySet<string>,
): Set<string> {
  const drawnPackages = new Set<string>();
  const drawn = new Set<string>();
  for (const t of viewModel.types) {
    if (hidden?.nodes.has(t.id)) continue;
    if (isPackageNode(t.id)) drawnPackages.add(packageNodeName(t.id));
    else drawn.add(t.id);
  }
  const out = new Set<string>();
  for (const t of model.types) {
    if (drawn.has(t.id)) continue;
    const owner = collapsedOwner(t.packageName, collapsed);
    if (owner !== null && drawnPackages.has(owner)) continue;
    out.add(t.id);
  }
  return out;
}

/** Relaciones del modelo mostrado cuyos dos extremos se dibujan y cuyo tipo no está filtrado. */
export function shownRelationsOf(viewModel: DiagramModel, hidden: DrawHidden | null): number {
  if (!hidden) return viewModel.relationships.length;
  return viewModel.relationships.filter(
    (r) => !hidden.relTypes.has(r.type) && !hidden.nodes.has(r.source) && !hidden.nodes.has(r.target),
  ).length;
}

const RE_RULE = /^(hide|remove)\s+(.+?)\s*$/iu;

/** ¿La regla `what` de un hide/remove nombra a este tipo? */
function ruleNames(what: string, t: TypeNode): boolean {
  const st = /^<<\s*(.+?)\s*>>$/u.exec(what);
  if (st?.[1]) return t.stereotypes.includes(st[1]);
  return what === t.id || what === t.name;
}

/**
 * Tipos que oculta el propio .puml (`hide Clase`, `hide <<estereotipo>>`, `hide @unlinked`) con la línea
 * (1-based, del texto dado) de la regla que los oculta; null si la regla no se encuentra en el texto (p. ej.
 * viene de un !include). La interfaz no puede mostrarlos: solo llevar a esa línea.
 */
export function hiddenByPuml(model: DiagramModel, source: string | null): Map<string, number | null> {
  const out = new Map<string, number | null>();
  if (!model.hide || model.hide.length === 0) return out;
  const kept = new Set(applyHide(model, parseHide(model.hide)).model.types.map((t) => t.id));
  const lines = source ? source.split(/\r\n|\r|\n/u) : [];
  for (const t of model.types) {
    if (kept.has(t.id)) continue;
    let at: number | null = null;
    // La última regla que lo nombra es la que manda (un "show" posterior la habría deshecho).
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = RE_RULE.exec((lines[i] ?? '').trim());
      const what = m?.[2];
      if (what && (ruleNames(what, t) || what.toLowerCase() === '@unlinked')) {
        at = i + 1;
        break;
      }
    }
    out.set(t.id, at);
  }
  return out;
}
