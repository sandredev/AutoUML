// src/presentation/diagram/layout/useLayout.ts — layout en Workers con timeout real y layout progresivo.
// - Worker "elk": puede bloquearse; si vence ELK_TIMEOUT_MS se hace terminate() y se recrea.
// - Worker "dagre": rápido; da el primer layout en grafos grandes y sirve de respaldo.
import { useEffect, useRef, useState } from 'react';
import type { DiagramModel } from '../../../domain/diagram/model';
import type { LayoutOptions, LayoutResult } from '../types';
import { hintsOf } from './stability';
import type { EngineRequest, LayoutRequest, LayoutResponse } from './layout.worker';
import LayoutWorker from './layout.worker?worker';

/** Tiempo máximo de ELK antes de matar su Worker y quedarse con dagre. */
export const ELK_TIMEOUT_MS = 4000;
/** A partir de este número de tipos se muestra primero dagre y ELK refina en segundo plano. */
export const PROGRESSIVE_MIN_NODES = 150;

export interface LayoutState {
  layout: LayoutResult | null;
  layoutModel: DiagramModel | null;
  loading: boolean;
  /** true mientras ELK refina un layout dagre ya visible. */
  refining: boolean;
  error: string | null;
  engine?: 'elk' | 'dagre';
  fallback?: string;
  /** Tiempo desde la petición hasta este layout, medido en el hilo principal. */
  ms?: number;
  /** Clave de las opciones con que se calculó este layout (T6: solo sirve de pista a layouts con las mismas). */
  reqKey?: string;
}

/** Último layout mostrado y la clave de opciones con que se calculó (T6: pista para el siguiente). */
export interface ShownLayout { layout: LayoutResult; reqKey: string }

interface Pending {
  id: number;
  model: DiagramModel;
  opts: LayoutOptions;
  t0: number;
  timer?: ReturnType<typeof setTimeout>;
  elkRunning: boolean;
  elkDone: boolean;
  dagreSent: boolean;
  dagreDone: boolean;
  reqKey: string;
  fallback?: string;
}

const EMPTY: LayoutState = { layout: null, layoutModel: null, loading: false, refining: false, error: null };

export function useLayout(
  model: DiagramModel | null,
  opts?: LayoutOptions,
  layoutVersion = 0,
  /** Layout que se está mostrando: si se calculó con las mismas opciones, sus posiciones son la pista (T6). */
  shown?: { readonly current: ShownLayout | null },
): LayoutState {
  const [state, setState] = useState<LayoutState>(EMPTY);
  const elkRef = useRef<Worker | null>(null);
  const dagreRef = useRef<Worker | null>(null);
  const cur = useRef<Pending | null>(null);
  const reqId = useRef(0);
  const summary = opts?.summary;
  const rankSep = opts?.rankSep;
  const nodeSep = opts?.nodeSep;
  const linetype = opts?.linetype;
  const moreTemplate = opts?.moreTemplate;
  // Dependencia primitiva: el objeto display puede ser nuevo en cada render con el mismo contenido.
  const displayKey = opts?.display ? JSON.stringify(opts.display) : '';

  // Las funciones viven en una ref para que los handlers de los Workers vean siempre la última versión.
  const api = useRef({
    send(kind: 'elk' | 'dagre', p: Pending): void {
      const w = kind === 'elk' ? elkRef.current : dagreRef.current;
      if (!w) return;
      const engine: EngineRequest = kind;
      const req: LayoutRequest = { id: p.id, model: p.model, opts: p.opts, engine };
      w.postMessage(req);
      if (kind === 'dagre') p.dagreSent = true;
      else {
        p.elkRunning = true;
        p.timer = setTimeout(() => api.current.elkFailed(p, `ELK superó ${ELK_TIMEOUT_MS} ms`), ELK_TIMEOUT_MS);
      }
    },
    /** ELK no sirve para esta petición (timeout o error): se mata si sigue corriendo y se usa dagre. */
    elkFailed(p: Pending, reason: string): void {
      if (cur.current !== p || p.elkDone) return;
      if (p.timer !== undefined) clearTimeout(p.timer);
      if (p.elkRunning) api.current.restartElk();
      p.elkRunning = false;
      p.elkDone = true;
      p.fallback = 'ELK falló, usando dagre: ' + reason;
      if (!p.dagreSent) api.current.send('dagre', p);
      else if (p.dagreDone) setState((s) => ({ ...s, loading: false, refining: false, fallback: p.fallback }));
    },
    restartElk(): void {
      elkRef.current?.terminate();
      elkRef.current = api.current.make('elk');
    },
    make(kind: 'elk' | 'dagre'): Worker | null {
      let w: Worker;
      try {
        w = new LayoutWorker();
      } catch (err) {
        setState({ ...EMPTY, error: 'No se pudo iniciar el Worker de layout: ' + (err instanceof Error ? err.message : String(err)) });
        return null;
      }
      w.onmessage = (e: MessageEvent<LayoutResponse>) => api.current.onResponse(kind, e.data);
      w.onerror = (e: ErrorEvent) => {
        const p = cur.current;
        if (!p) return;
        if (kind === 'elk') api.current.elkFailed(p, e.message || 'error en el Worker');
        else setState({ ...EMPTY, error: e.message || 'Error en el cálculo del layout' });
      };
      return w;
    },
    onResponse(kind: 'elk' | 'dagre', d: LayoutResponse): void {
      const p = cur.current;
      if (!p || d.id !== p.id || d.id !== reqId.current) return; // obsoleta
      if (kind === 'elk') {
        if (p.timer !== undefined) clearTimeout(p.timer);
        p.elkRunning = false;
        if (!d.ok) { api.current.elkFailed(p, d.error); return; }
        p.elkDone = true;
      } else {
        p.dagreDone = true;
        if (!d.ok) { setState({ ...EMPTY, error: d.error }); return; }
        if (p.elkDone && !p.fallback) return; // ELK ya llegó: dagre tardío, se ignora
      }
      if (!d.ok) return;
      const next: LayoutState = {
        layout: d.result,
        layoutModel: p.model,
        loading: false,
        refining: kind === 'dagre' && !p.elkDone,
        error: null,
        engine: d.engine,
        ms: Math.round(performance.now() - p.t0),
        reqKey: p.reqKey,
      };
      const fb = kind === 'dagre' ? p.fallback : d.fallback;
      if (fb !== undefined) next.fallback = fb;
      if (import.meta.env.DEV) console.debug('[layout] engine=%s ms=%d', next.engine, next.ms);
      setState(next);
    },
  });

  useEffect(() => {
    elkRef.current = api.current.make('elk');
    dagreRef.current = api.current.make('dagre');
    return () => {
      const p = cur.current;
      if (p?.timer !== undefined) clearTimeout(p.timer);
      elkRef.current?.terminate();
      dagreRef.current?.terminate();
      elkRef.current = null;
      dagreRef.current = null;
    };
  }, []);

  useEffect(() => {
    const id = ++reqId.current;
    // Cancela la petición anterior: si ELK seguía bloqueado, su Worker se mata.
    const prev = cur.current;
    if (prev) {
      if (prev.timer !== undefined) clearTimeout(prev.timer);
      if (prev.elkRunning) api.current.restartElk();
      prev.elkRunning = false;
    }
    if (!model) {
      cur.current = null;
      setState(EMPTY);
      return;
    }
    const o: LayoutOptions = {};
    if (summary !== undefined) o.summary = summary;
    if (rankSep !== undefined) o.rankSep = rankSep;
    if (nodeSep !== undefined) o.nodeSep = nodeSep;
    if (linetype !== undefined) o.linetype = linetype;
    if (moreTemplate !== undefined) o.moreTemplate = moreTemplate;
    if (displayKey) o.display = JSON.parse(displayKey) as NonNullable<LayoutOptions['display']>;
    // Misma clave ⇒ solo cambió el modelo (o los paquetes plegados): se conservan las posiciones.
    // Si cambiaron rankSep, summary… o se pidió "Restablecer" (layoutVersion), el layout viejo es mala pista.
    const reqKey = [summary, rankSep, nodeSep, linetype, moreTemplate, displayKey, layoutVersion].join('|');
    const prevShown = shown?.current;
    if (prevShown && prevShown.reqKey === reqKey) o.hints = hintsOf(prevShown.layout);
    const p: Pending = { id, model, opts: o, t0: performance.now(), elkRunning: false, elkDone: false, dagreSent: false, dagreDone: false, reqKey };
    cur.current = p;
    setState((s) => ({ ...s, loading: true, refining: false, error: null }));
    if (model.types.length > PROGRESSIVE_MIN_NODES) api.current.send('dagre', p);
    api.current.send('elk', p);
  // `shown` es una ref: se lee al pedir el layout, no debe provocar otro.
  }, [model, summary, rankSep, nodeSep, linetype, moreTemplate, displayKey, layoutVersion]);

  return state;
}
