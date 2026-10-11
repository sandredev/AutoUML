// src/presentation/diagram/layout/useDiagramLayout.ts — hide + paquetes plegados + foco + notas sobre useLayout, con
// caché de layouts por conjunto de paquetes plegados (desplegar recupera el layout anterior al instante) y por foco
// (T8: salir del modo foco recupera el layout completo sin recalcular).
import { useEffect, useMemo, useRef } from 'react';
import type { DiagramModel } from '../../../domain/diagram/model';
import { applyHide, parseHide } from '../graph/hide';
import { applyFocus, focusKey, type FocusSpec } from '../graph/neighborhood';
import { linetypeOf, visibilityIconsOf } from '../style/skin';
import type { CardDisplay } from '../style/contract';
import type { LayoutOptions, LayoutResult } from '../types';
import { aggregateCollapsed, collapsedKey } from './aggregate';
import { placeNotes } from './notes';
import { useLayout, type LayoutState, type ShownLayout } from './useLayout';

export interface DiagramLayoutState extends Omit<LayoutState, 'layoutModel'> {
  /**
   * Modelo ORIGINAL (el que pasó el host) del layout que se muestra. PumlViewer lo compara con su
   * `model` para saber si el layout ya es del modelo actual.
   */
  layoutModel: DiagramModel | null;
  /** Modelo filtrado, agregado y enfocado que corresponde a `layout`: el que dibuja DiagramCanvas. */
  viewModel: DiagramModel | null;
  /** Paquete plegado → entidades, del `viewModel` mostrado. */
  packageCounts: ReadonlyMap<string, number>;
  display: CardDisplay | undefined;
  /** Modelo agregado actual (sin foco): donde se buscan los ids que se pueden enfocar. */
  focusableModel: DiagramModel | null;
  /** true si el foco pedido se aplicó (su id existe en el modelo agregado actual). */
  focusApplied: boolean;
}

interface Derived {
  source: DiagramModel;
  counts: ReadonlyMap<string, number>;
}

const EMPTY_COUNTS: ReadonlyMap<string, number> = new Map();

export function useDiagramLayout(
  model: DiagramModel | null,
  collapsed: ReadonlySet<string>,
  opts?: LayoutOptions,
  layoutVersion = 0,
  focus: FocusSpec | null = null,
): DiagramLayoutState {
  const hidden = useMemo(
    () => (model ? applyHide(model, parseHide(model.hide ?? []), visibilityIconsOf(model.skinparams)) : null),
    [model],
  );
  const cKey = collapsedKey(collapsed);
  // `collapsed` puede ser un Set nuevo con el mismo contenido: se depende de su clave (primitiva).
  const stableCollapsed = useMemo<ReadonlySet<string>>(() => new Set(cKey ? cKey.split('\n') : []), [cKey]);
  const agg = useMemo(
    () => (hidden ? aggregateCollapsed(hidden.model, stableCollapsed) : null),
    [hidden, stableCollapsed],
  );

  // Foco (T8) sobre el modelo agregado: un paquete plegado es un nodo más. Se depende de su clave (primitiva).
  const fKey = focusKey(focus);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableFocus = useMemo(() => focus, [fKey]);
  const viewIn = useMemo(() => (agg ? applyFocus(agg.model, stableFocus) : null), [agg, stableFocus]);
  const focusApplied = viewIn !== null && agg !== null && viewIn !== agg.model;
  const key = focusApplied ? cKey + '\u0001' + fKey : cKey;

  // Modelo que va al layout → modelo original y contadores: así el layout mostrado y su modelo van juntos.
  const derived = useRef(new WeakMap<DiagramModel, Derived>());
  if (agg && viewIn && model && !derived.current.has(viewIn)) derived.current.set(viewIn, { source: model, counts: agg.counts });

  const linetype = linetypeOf(model?.skinparams);
  const display = hidden?.display;
  const lopts = useMemo<LayoutOptions>(() => {
    const o: LayoutOptions = { ...opts };
    if (linetype) o.linetype = linetype;
    if (display) o.display = display;
    return o;
  }, [opts, linetype, display]);

  // Caché por conjunto plegado + foco; se vacía si cambian el modelo, las opciones o se fuerza el recálculo.
  const cache = useRef(new Map<string, LayoutState>());
  const cacheDeps = useRef<unknown[]>([]);
  const deps = [model, opts?.summary, opts?.rankSep, opts?.nodeSep, opts?.moreTemplate, layoutVersion];
  if (deps.length !== cacheDeps.current.length || deps.some((d, i) => d !== cacheDeps.current[i])) {
    cache.current.clear();
    cacheDeps.current = deps;
  }
  const cached = cache.current.get(key);

  // Layout que se está mostrando (T6): su posición es la pista del siguiente cálculo. Se actualiza en un
  // efecto, DESPUÉS de que useLayout pida el layout nuevo, así que al pedirlo aún guarda el anterior.
  const shown = useRef<ShownLayout | null>(null);
  const st = useLayout(cached ? null : viewIn, lopts, layoutVersion, shown);

  // Guarda en caché el layout final (ELK o respaldo) del conjunto plegado y foco actuales.
  useEffect(() => {
    if (viewIn && st.layout && !st.loading && !st.refining && st.layoutModel === viewIn) cache.current.set(key, st);
  }, [st, viewIn, key]);

  // Último layout mostrado: mientras se calcula otro (al plegar sin caché) se sigue viendo el anterior
  // en vez de desmontar el lienzo, que perdería la vista y las posiciones manuales.
  const lastShown = useRef<LayoutState | null>(null);
  let base: LayoutState;
  if (cached) base = cached;
  else if (st.layout) base = st;
  else base = lastShown.current && model ? { ...lastShown.current, loading: st.loading, error: st.error } : st;
  if (base.layout) lastShown.current = base;
  if (!model) lastShown.current = null;

  useEffect(() => {
    shown.current = base.layout && base.reqKey !== undefined ? { layout: base.layout, reqKey: base.reqKey } : null;
  }, [base.layout, base.reqKey]);

  const shownModel = base.layoutModel;
  const layout = useMemo<LayoutResult | null>(
    () => (base.layout && shownModel ? placeNotes(shownModel, base.layout) : base.layout),
    [base.layout, shownModel],
  );
  const meta = shownModel ? derived.current.get(shownModel) : undefined;

  return {
    ...base,
    loading: cached ? false : st.loading || (st.layout === null && model !== null),
    layout,
    layoutModel: meta?.source ?? null,
    viewModel: shownModel,
    packageCounts: meta?.counts ?? EMPTY_COUNTS,
    display,
    focusableModel: agg?.model ?? null,
    focusApplied,
  };
}
