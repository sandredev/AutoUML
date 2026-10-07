// src/render/layout/useLayout.ts — calcula el layout en un Worker.
import { useEffect, useRef, useState } from 'react';
import type { DiagramModel } from '../../core/model';
import type { LayoutOptions, LayoutResult } from '../types';
import type { LayoutRequest, LayoutResponse } from './layout.worker';

export interface LayoutState {
  layout: LayoutResult | null;
  loading: boolean;
  error: string | null;
}

export function useLayout(model: DiagramModel | null, opts?: LayoutOptions): LayoutState {
  const [state, setState] = useState<LayoutState>({ layout: null, loading: false, error: null });
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const summary = opts?.summary;
  const rankSep = opts?.rankSep;
  const nodeSep = opts?.nodeSep;

  useEffect(() => {
    const w = new Worker(new URL('./layout.worker.ts', import.meta.url));
    workerRef.current = w;
    w.onmessage = (e: MessageEvent<LayoutResponse>) => {
      const d = e.data;
      if (d.id !== reqId.current) return; // respuesta obsoleta
      setState(d.ok ? { layout: d.result, loading: false, error: null } : { layout: null, loading: false, error: d.error });
    };
    w.onerror = (e: ErrorEvent) => {
      setState({ layout: null, loading: false, error: e.message || 'Error en el cálculo del layout' });
    };
    return () => {
      w.terminate();
      workerRef.current = null;
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
