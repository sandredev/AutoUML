// src/render/types.ts
import type { RelType } from '../core/model';

export interface NodeBox {
  id: string;          // TypeNode.id
  x: number; y: number; // esquina superior izquierda, en unidades de mundo
  w: number; h: number;
  /** Etiqueta y subtítulo para nodos agregados, como un paquete contraído. */
  label?: string;
  subtitle?: string;
  packageName?: string;
}

export interface EdgePath {
  source: string;      // id
  target: string;      // id
  type: RelType;
  label?: string;
  /** Polilínea en unidades de mundo: [x0,y0,x1,y1,...]; el último punto toca al destino (aquí va la flecha). */
  points: number[];
  /**
   * Cómo se calculó la ruta. 'orthogonal' (ELK): solo tramos horizontales/verticales, se dibuja con
   * esquinas redondeadas. Sin valor o 'polyline' (dagre): se dibuja tal cual.
   * Opcional para no romper los layouts ni los tests existentes.
   */
  routing?: 'orthogonal' | 'polyline';
}

export interface PackageBox {
  name: string;
  x: number; y: number; w: number; h: number;
  layer?: string;
}

export interface LayoutResult {
  nodes: NodeBox[];
  edges: EdgePath[];
  packages: PackageBox[];
  /** Caja que contiene todo. */
  bounds: { x: number; y: number; w: number; h: number };
}

export interface LayoutOptions {
  /** true = tarjetas compactas (solo nombre), false = con miembros. Por defecto: model.summaryMode. */
  summary?: boolean;
  /** Separación entre niveles y entre nodos hermanos, en unidades de mundo. */
  rankSep?: number; // por defecto 80
  nodeSep?: number; // por defecto 40
}

export interface ViewState {
  /** Zoom (1 = 100 %). */
  scale: number;
  /** Desplazamiento en píxeles de pantalla del origen del mundo. */
  tx: number; ty: number;
}
