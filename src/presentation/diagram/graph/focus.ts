// src/presentation/diagram/graph/focus.ts — qué queda sin atenuar al seleccionar una clase o una arista (puro).
import type { LayoutResult } from '../types';

export interface Focus {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<number>;
}

/** Arista seleccionada: ella y sus dos clases. Clase seleccionada: ella, sus vecinos y sus aristas. */
export function focusOf(layout: LayoutResult, nodeId: string | null, edgeIndex: number | null): Focus | null {
  if (edgeIndex !== null) {
    const e = layout.edges[edgeIndex];
    if (!e) return null;
    return { nodes: new Set([e.source, e.target]), edges: new Set([edgeIndex]) };
  }
  if (nodeId === null || !layout.nodes.some((n) => n.id === nodeId)) return null;
  const nodes = new Set<string>([nodeId]);
  const edges = new Set<number>();
  layout.edges.forEach((e, i) => {
    if (e.source === nodeId || e.target === nodeId) {
      edges.add(i);
      nodes.add(e.source);
      nodes.add(e.target);
    }
  });
  return { nodes, edges };
}
