// src/render/layout/layout.worker.ts — Worker de módulo que ejecuta computeLayout.
import type { DiagramModel } from '../../core/model';
import type { LayoutOptions, LayoutResult } from '../types';
import { computeLayout } from './layout';

export interface LayoutRequest {
  id: number;
  model: DiagramModel;
  opts?: LayoutOptions;
}
export type LayoutResponse =
  | { id: number; ok: true; result: LayoutResult }
  | { id: number; ok: false; error: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(msg: LayoutResponse): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id, model, opts } = e.data;
  try {
    scope.postMessage({ id, ok: true, result: computeLayout(model, opts) });
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
