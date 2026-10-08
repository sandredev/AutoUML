// src/render/layout/useLayout.ts — calcula el layout en un Worker.
import { useEffect, useRef, useState } from 'react';
import type { DiagramModel } from '../../core/model';
import type { DetailOptions } from '../style/contract';
import type { LayoutOptions, LayoutResult } from '../types';
import type { LayoutRequest, LayoutResponse } from './layout.worker';
// `?worker` hace que Vite empaquete el worker con worker.format (iife), en dev y en build.
import LayoutWorker from './layout.worker?worker';

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
  const direction = opts?.direction;
  const clusters = opts?.clusters;
  // Clave estable: el objeto detail puede cambiar de identidad sin cambiar de valor.
  const detailKey = opts?.detail ? JSON.stringify(opts.detail) : '';

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
      if (d.id !== reqId.current) return;
      setState(d.ok ? { layout: d.result, loading: false, error: null } : { layout: null, loading: false, error: d.error });
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
    if (direction !== undefined) o.direction = direction;
    if (clusters !== undefined) o.clusters = clusters;
    if (detailKey !== '') o.detail = JSON.parse(detailKey) as DetailOptions;
    setState((s) => ({ ...s, loading: true, error: null }));
    const req: LayoutRequest = { id, model, opts: o };
    w.postMessage(req);
  }, [model, summary, rankSep, nodeSep, direction, clusters, detailKey]);

  return state;
}
