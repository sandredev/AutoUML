// src/render/layout/layout.worker.ts — Worker: intenta ELK (bundled) y cae a dagre.
import type { DiagramModel } from '../../core/model';
import type { LayoutOptions, LayoutResult } from '../types';
import { runLayoutWithFallback } from './elkLayout';

export interface LayoutRequest {
  id: number;
  model: DiagramModel;
  opts?: LayoutOptions;
}
export type LayoutResponse =
  | { id: number; ok: true; result: LayoutResult; engine: 'elk' | 'dagre'; fallback?: string; ms: number }
  | { id: number; ok: false; error: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(msg: LayoutResponse): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id, model, opts } = e.data;
  runLayoutWithFallback(model, opts).then(
    (r) => {
      const msg: LayoutResponse = { id, ok: true, result: r.result, engine: r.engine, ms: r.ms };
      if (r.fallback !== undefined) msg.fallback = r.fallback;
      scope.postMessage(msg);
    },
    (err: unknown) => {
      scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
    },
  );
};
