// src/presentation/diagram/analysis/overlay.ts — capa de análisis sobre el dibujo (T9). Pura (sin DOM ni React).
//
// Es SOLO dibujo: no toca el modelo que entra al layout, así que activarla o cambiar la métrica no recalcula
// posiciones ni pierde las manuales; desactivarla devuelve exactamente el dibujo de antes.
//   - Aristas: 'cycle' si la dependencia está dentro de un ciclo; 'violation' si va hacia una capa superior.
//     El ciclo manda (una arista puede ser las dos cosas). El dibujo les da color Y trazo propio (doble /
//     raya-punto): el color nunca es la única señal.
//   - Calor: cada tipo analizado cae en uno de HEAT_STEPS tramos iguales de la métrica. Los colores los pone
//     el tema (--heat-1…5), que es una rampa secuencial de un solo tono.
import type { DiagramAnalysis } from '../../../domain/analysis/analyze';
import type { DiagramModel } from '../../../domain/diagram/model';
import { isPackageNode, packageNodeName } from '../layout/aggregate';
import type { EdgePath } from '../types';

export type HeatMetric = 'none' | 'fanIn' | 'fanOut' | 'instability';
export type EdgeMark = 'cycle' | 'violation';

/** Tramos de la escala de calor (uno por color de la rampa). */
export const HEAT_STEPS = 5;

/** Respaldo si el tema no define los tokens (exportación, tests): los valores del tema claro de theme.css. */
export const FALLBACK_HEAT: readonly string[] = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
export const FALLBACK_MARK_CYCLE = '#d03b3b';
export const FALLBACK_MARK_VIOLATION = '#6250d6';

export interface HeatLegend {
  metric: Exclude<HeatMetric, 'none'>;
  min: number;
  max: number;
}

export interface AnalysisOverlay {
  edgeMark(source: string, target: string): EdgeMark | null;
  /** Paquete → índice del ciclo de paquetes en que está (para las aristas agregadas de paquetes plegados). */
  packageCycleOf: ReadonlyMap<string, number>;
  /** Tipo → tramo de calor 0…HEAT_STEPS−1; null sin métrica. */
  heat: ReadonlyMap<string, number> | null;
  legend: HeatLegend | null;
}

/** Tramo de `value` en [min, max] partido en `steps` tramos iguales; el máximo cae en el último. */
export function heatBin(value: number, min: number, max: number, steps = HEAT_STEPS): number {
  if (max <= min) return 0;
  const k = Math.floor(((value - min) / (max - min)) * steps);
  return Math.max(0, Math.min(steps - 1, k));
}

export function buildOverlay(a: DiagramAnalysis, metric: HeatMetric): AnalysisOverlay {
  const packageCycleOf = new Map<string, number>();
  a.packageCycles.forEach((c, i) => c.members.forEach((p) => packageCycleOf.set(p, i)));
  let heat: Map<string, number> | null = null;
  let legend: HeatLegend | null = null;
  if (metric !== 'none') {
    const value = (id: string): number => {
      const c = a.coupling.get(id);
      if (!c) return 0;
      return metric === 'fanIn' ? c.ca : metric === 'fanOut' ? c.ce : c.instability;
    };
    // Escala desde 0 (no desde el mínimo observado): "0 dependencias" siempre es el color más suave.
    let max = metric === 'instability' ? 1 : 0;
    if (metric !== 'instability') for (const id of a.graph.nodes) max = Math.max(max, value(id));
    heat = new Map(a.graph.nodes.map((id) => [id, heatBin(value(id), 0, max)]));
    legend = { metric, min: 0, max };
  }
  return {
    edgeMark: (s, t) => (a.isCycleEdge(s, t) ? 'cycle' : a.isViolationEdge(s, t) ? 'violation' : null),
    packageCycleOf,
    heat,
    legend,
  };
}

/** Marca de una arista del layout: por su relación del modelo (sentido real) o entre paquetes plegados. */
export function markOfEdge(o: AnalysisOverlay, model: DiagramModel, e: EdgePath): EdgeMark | null {
  if (isPackageNode(e.source) || isPackageNode(e.target)) {
    if (!isPackageNode(e.source) || !isPackageNode(e.target)) return null;
    const i = o.packageCycleOf.get(packageNodeName(e.source));
    return i !== undefined && i === o.packageCycleOf.get(packageNodeName(e.target)) ? 'cycle' : null;
  }
  const r = e.rel !== undefined ? model.relationships[e.rel] : undefined;
  if (r?.associationClass !== undefined) return null;
  return r ? o.edgeMark(r.source, r.target) : o.edgeMark(e.source, e.target);
}
