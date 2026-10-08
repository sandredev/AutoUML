// src/render/layout/useLayout.ts — calcula el layout en un Worker (ELK con respaldo dagre).
import { useEffect, useRef, useState } from 'react';
import type { DiagramModel } from '../../core/model';
import type { LayoutOptions, LayoutResult } from '../types';
import type { LayoutRequest, LayoutResponse } from './layout.worker';
// `?worker` hace que Vite empaquete el worker con worker.format (iife), en dev y en build.
import LayoutWorker from './layout.worker?worker';

export interface LayoutState {
  layout: LayoutResult | null;
  loading: boolean;
  error: string | null;
  engine?: 'elk' | 'dagre';
  fallback?: string;
  ms?: number;
}

export function useLayout(model: DiagramModel | null, opts?: LayoutOptions): LayoutState {
  const [state, setState] = useState<LayoutState>({ layout: null, loading: false, error: null });
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const summary = opts?.summary;
  const rankSep = opts?.rankSep;
  const nodeSep = opts?.nodeSep;

  useEffect(() => {
    let w: Worker;
    try {
      w = new LayoutWorker();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ layout: null, loading: false, error: 'No se pudo iniciar el Worker de layout: ' + msg });
      return;
    }
    workerRef.current = w;
    w.onmessage = (e: MessageEvent<LayoutResponse>) => {
      const d = e.data;
      if (d.id !== reqId.current) return; // respuesta obsoleta
      if (!d.ok) {
        setState({ layout: null, loading: false, error: d.error });
        return;
      }
      if (import.meta.env.DEV) {
        console.debug('[layout] engine=%s ms=%d', d.engine, d.ms);
        if (d.fallback) console.warn('[layout] ' + d.fallback);
      }
      const next: LayoutState = { layout: d.result, loading: false, error: null, engine: d.engine, ms: d.ms };
      if (d.fallback !== undefined) next.fallback = d.fallback;
      setState(next);
    };
    w.onerror = (e: ErrorEvent) => {
      setState({ layout: null, loading: false, error: e.message || 'Error en el cálculo del layout' });
    };
    return () => {
      w.terminate();
      if (workerRef.current === w) workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const id = ++reqId.current;
    if (!model) {
      setState({ layout: null, loading: false, error: null });
      return;
    }
    const w = workerRef.current;
    if (!w) return;
    const o: LayoutOptions = {};
    if (summary !== undefined) o.summary = summary;
    if (rankSep !== undefined) o.rankSep = rankSep;
    if (nodeSep !== undefined) o.nodeSep = nodeSep;
    setState((s) => ({ ...s, loading: true, error: null }));
    const req: LayoutRequest = { id, model, opts: o };
    w.postMessage(req);
  }, [model, summary, rankSep, nodeSep]);

  return state;
}
