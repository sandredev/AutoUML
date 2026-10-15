// src/presentation/diagram/types.ts
import type { RelType } from '../../domain/diagram/model';
import type { LayoutHints } from './layout/stability';
import type { CardDisplay } from './style/contract';

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
  /** Índice en model.relationships: el dibujo saca de ahí cabezas, multiplicidades y estilo. */
  rel?: number;
  /** true si es un bucle de una clase consigo misma. */
  self?: boolean;
}

export interface PackageBox {
  name: string;
  x: number; y: number; w: number; h: number;
  layer?: string;
}

/** Nota colocada en el lienzo (T4). */
export interface NoteBox {
  id: string;
  x: number; y: number; w: number; h: number;
  /** Texto ya partido en líneas. */
  lines: string[];
  /** id del NodeBox al que apunta (línea punteada), si tiene anchor. */
  anchor?: string;
}

export interface LayoutResult {
  nodes: NodeBox[];
  edges: EdgePath[];
  packages: PackageBox[];
  /** Notas colocadas (T4). Opcional para no romper layouts ni tests existentes. */
  notes?: NoteBox[];
  /** Caja que contiene todo. */
  bounds: { x: number; y: number; w: number; h: number };
}

export interface LayoutOptions {
  /** true = tarjetas compactas (solo nombre), false = con miembros. Por defecto: model.summaryMode. */
  summary?: boolean;
  /** Separación entre niveles y entre nodos hermanos, en unidades de mundo. */
  rankSep?: number; // por defecto 80
  nodeSep?: number; // por defecto 40
  /** skinparam linetype: 'polyline' → ELK POLYLINE; 'ortho' o sin valor → ORTHOGONAL. dagre lo ignora. */
  linetype?: 'ortho' | 'polyline';
  /** hide/show y skinparam que cambian el tamaño de las tarjetas (objeto plano: viaja al Worker). */
  display?: CardDisplay;
  /** Plantilla traducida de "… +{n} más" para medir la fila igual que se dibuja. */
  moreTemplate?: string;
  /**
   * Posiciones del layout anterior (T6). Con ellas ELK pasa a modo interactivo y las tarjetas que ya
   * existían se quedan donde estaban; dagre solo ancla el resultado. Sin pistas: layout desde cero.
   */
  hints?: LayoutHints;
}

export interface ViewState {
  /** Zoom (1 = 100 %). */
  scale: number;
  /** Desplazamiento en píxeles de pantalla del origen del mundo. */
  tx: number; ty: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export type RelationKind =
  | 'inheritance'
  | 'implementation'
  | 'composition'
  | 'aggregation'
  | 'dependency'
  | 'association';

export interface DiagramNodeLayout {
  id: string;
  name: string;
  packagePath?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramPackageLayout {
  id: string;
  name: string;
  fullPath: string;
  parentPath?: string;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramEdgeLayout {
  id: string;
  source: string;
  target: string;
  kind: RelationKind;
  label?: string;
  sourceLabel?: string;
  targetLabel?: string;
  points: Point2D[];
  /** Si el usuario movió o partió segmentos manualmente, se preservan aquí */
  manualPoints?: Point2D[];
}

export interface DiagramLayoutModel {
  nodes: Map<string, DiagramNodeLayout>;
  packages: DiagramPackageLayout[];
  edges: DiagramEdgeLayout[];
  width: number;
  height: number;
}

export interface DiagramOverridesState {
  nodePositions: Map<string, Point2D>;
  edgeWaypoints: Map<string, Point2D[]>;
  packageNestingOverrides: Map<string, string | null>; // pkgFullPath -> newParentFullPath
}
