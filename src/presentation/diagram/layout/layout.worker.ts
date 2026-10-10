// src/presentation/diagram/layout/layout.worker.ts — Worker de layout. El motor lo elige el hilo principal.
import type { DiagramModel } from '../../../domain/diagram/model';
import type { LayoutOptions, LayoutResult } from '../types';
import { computeElkLayout, runLayoutWithFallback } from './elkLayout';
import { computeLayout } from './layout';

export type EngineRequest = 'elk' | 'dagre' | 'auto';

export interface LayoutRequest {
  id: number;
  model: DiagramModel;
  opts?: LayoutOptions;
  /** 'elk' = solo ELK (si falla responde ok:false); 'dagre' = solo dagre; 'auto' = ELK con respaldo. */
  engine?: EngineRequest;
}
export type LayoutResponse =
  | { id: number; ok: true; result: LayoutResult; engine: 'elk' | 'dagre'; fallback?: string; ms: number }
  | { id: number; ok: false; error: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(msg: LayoutResponse): void;
}
const scope = self as unknown as WorkerScope;
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

scope.onmessage = (e) => {
  const { id, model, opts, engine = 'auto' } = e.data;
  const t0 = performance.now();
  const ms = (): number => Math.round(performance.now() - t0);

  if (engine === 'dagre') {
    try {
      scope.postMessage({ id, ok: true, result: computeLayout(model, opts), engine: 'dagre', ms: ms() });
    } catch (err) {
      scope.postMessage({ id, ok: false, error: errText(err) });
    }
    return;
  }
  if (engine === 'elk') {
    computeElkLayout(model, opts).then(
      (result) => scope.postMessage({ id, ok: true, result, engine: 'elk', ms: ms() }),
      (err: unknown) => scope.postMessage({ id, ok: false, error: errText(err) }),
    );
    return;
  }
  runLayoutWithFallback(model, opts).then(
    (r) => {
      const msg: LayoutResponse = { id, ok: true, result: r.result, engine: r.engine, ms: r.ms };
      if (r.fallback !== undefined) msg.fallback = r.fallback;
      scope.postMessage(msg);
    },
    (err: unknown) => scope.postMessage({ id, ok: false, error: errText(err) }),
  );
};
