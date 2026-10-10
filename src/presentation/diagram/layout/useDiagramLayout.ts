// src/presentation/diagram/layout/useDiagramLayout.ts — hide + paquetes plegados + notas sobre useLayout, con caché
// de layouts por conjunto de paquetes plegados (desplegar recupera el layout anterior al instante).
import { useEffect, useMemo, useRef } from 'react';
import type { DiagramModel } from '../../../domain/diagram/model';
import { applyHide, parseHide } from '../graph/hide';
import { linetypeOf, visibilityIconsOf } from '../style/skin';
import type { CardDisplay } from '../style/contract';
import type { LayoutOptions, LayoutResult } from '../types';
import { aggregateCollapsed, collapsedKey } from './aggregate';
import { placeNotes } from './notes';
import { useLayout, type LayoutState } from './useLayout';

export interface DiagramLayoutState extends Omit<LayoutState, 'layoutModel'> {
  /**
   * Modelo ORIGINAL (el que pasó el host) del layout que se muestra. PumlViewer lo compara con su
   * `model` para saber si el layout ya es del modelo actual.
   */
  layoutModel: DiagramModel | null;
  /** Modelo filtrado y agregado que corresponde a `layout`: el que dibuja DiagramCanvas. */
  viewModel: DiagramModel | null;
  /** Paquete plegado → entidades, del `viewModel` mostrado. */
  packageCounts: ReadonlyMap<string, number>;
  display: CardDisplay | undefined;
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
): DiagramLayoutState {
  const hidden = useMemo(
    () => (model ? applyHide(model, parseHide(model.hide ?? []), visibilityIconsOf(model.skinparams)) : null),
    [model],
  );
  const key = collapsedKey(collapsed);
  // `collapsed` puede ser un Set nuevo con el mismo contenido: se depende de su clave (primitiva).
  const stableCollapsed = useMemo<ReadonlySet<string>>(() => new Set(key ? key.split('\n') : []), [key]);
  const agg = useMemo(
    () => (hidden ? aggregateCollapsed(hidden.model, stableCollapsed) : null),
    [hidden, stableCollapsed],
  );

  // Modelo agregado → modelo original y contadores: así el layout mostrado y su modelo van juntos.
  const derived = useRef(new WeakMap<DiagramModel, Derived>());
  if (agg && model && !derived.current.has(agg.model)) derived.current.set(agg.model, { source: model, counts: agg.counts });

  const linetype = linetypeOf(model?.skinparams);
  const display = hidden?.display;
  const lopts = useMemo<LayoutOptions>(() => {
    const o: LayoutOptions = { ...opts };
    if (linetype) o.linetype = linetype;
    if (display) o.display = display;
    return o;
  }, [opts, linetype, display]);

  // Caché por conjunto plegado; se vacía si cambian el modelo, las opciones o se fuerza el recálculo.
  const cache = useRef(new Map<string, LayoutState>());
  const cacheDeps = useRef<unknown[]>([]);
  const deps = [model, opts?.summary, opts?.rankSep, opts?.nodeSep, opts?.moreTemplate, layoutVersion];
  if (deps.length !== cacheDeps.current.length || deps.some((d, i) => d !== cacheDeps.current[i])) {
    cache.current.clear();
    cacheDeps.current = deps;
  }
  const cached = cache.current.get(key);

  const st = useLayout(cached ? null : (agg?.model ?? null), lopts, layoutVersion);

  // Guarda en caché el layout final (ELK o respaldo) del conjunto plegado actual.
  useEffect(() => {
    if (agg && st.layout && !st.loading && !st.refining && st.layoutModel === agg.model) cache.current.set(key, st);
  }, [st, agg, key]);

  // Último layout mostrado: mientras se calcula otro (al plegar sin caché) se sigue viendo el anterior
  // en vez de desmontar el lienzo, que perdería la vista y las posiciones manuales.
  const lastShown = useRef<LayoutState | null>(null);
  let base: LayoutState;
  if (cached) base = cached;
  else if (st.layout) base = st;
  else base = lastShown.current && model ? { ...lastShown.current, loading: st.loading, error: st.error } : st;
  if (base.layout) lastShown.current = base;
  if (!model) lastShown.current = null;

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
  };
}
