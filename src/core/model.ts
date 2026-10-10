// Modelo interno del visualizador (copia de MODELO-DATOS.md). Sin lógica en la Fase 1.
// Módulo puro: sin dependencias de Electron ni de React.

/** Tipo primitivo declarado en el .puml (lo que dice la palabra clave). */
export type DeclaredKind =
  | 'class'
  | 'abstract'
  | 'interface'
  | 'enum'
  | 'record'
  | 'annotation'
  | 'struct'
  | 'entity'
  | 'exception'
  | 'protocol'
  | 'object'
  | 'circle'
  | 'diamond'
  | 'metaclass'
  | 'stereotype'
  | 'dataclass';

/** Categoría de la sidebar (excluyente): sealed tiene prioridad. */
export type Category =
  | 'sealed'
  | 'abstract'
  | 'interface'
  | 'enum'
  | 'record'
  | 'annotation'
  | 'class'
  | 'external'
  | 'undeclared';

export type RelType = 'EXTENDS' | 'IMPLEMENTS' | 'ASSOCIATION' | 'DEPENDENCY' | 'COMPOSITION' | 'AGGREGATION';

/** Forma de la punta en un extremo de la arista. */
export type HeadType =
  | 'none'
  | 'open'
  | 'triangle'
  | 'diamond'
  | 'diamond-filled'
  | 'cross'
  | 'circle'
  | 'plus'
  | 'square';

export type Visibility = '+' | '-' | '#' | '~';

export interface AttributeModel {
  name: string;
  type: string;
  visibility: Visibility;
  isStatic: boolean;
}

export interface ParameterModel {
  name: string;
  type: string;
}

export interface MethodModel {
  name: string;
  returnType: string;
  parameters: ParameterModel[];
  /** Número N si el .puml abrevió los parámetros como "…N". */
  parametersAbbreviated?: number;
  visibility: Visibility;
  isStatic: boolean;
  isAbstract: boolean;
}

export interface ConstructorModel {
  name: string;
  parameters: ParameterModel[];
  parametersAbbreviated?: number;
  visibility: Visibility;
}

export interface TypeNode {
  /** Identificador estable usado por las relaciones: el alias si existe; si no, el nombre. */
  id: string;
  /** Nombre visible (el de las comillas, o el identificador). */
  name: string;
  /** Paquete real (p. ej. "x.domain"); "(default package)" si no tiene. */
  packageName: string;
  declaredKind: DeclaredKind;
  category: Category;
  isAbstract: boolean;
  isSealed: boolean;
  isExternal: boolean;
  /** Color de relleno de la cabecera ("#LightBlue", "#FF0000"). */
  color?: string;
  /** Color del borde ("line:red" o "##red"). */
  lineColor?: string;
  /** true si solo apareció en una relación y nunca fue declarado. */
  implicit: boolean;
  stereotypes: string[];
  attributes: AttributeModel[];
  methods: MethodModel[];
  constructors: ConstructorModel[];
  enumConstants: string[];
  /** Línea (1-based) de la declaración en el .puml. */
  line: number;
}

export interface RelationshipModel {
  /** id del origen. En EXTENDS/IMPLEMENTS: el HIJO o la implementación. */
  source: string;
  /** id del destino. En EXTENDS/IMPLEMENTS: el PADRE o la interfaz. */
  target: string;
  type: RelType;
  label?: string;
  /** En COMPOSITION/AGGREGATION el origen es el todo (rombo en source). */
  sourceHead?: HeadType;
  targetHead?: HeadType;
  sourceLabel?: string;
  targetLabel?: string;
  /** Sentido de la etiqueta (": texto >" / ": texto <") respecto a source→target. */
  labelArrow?: 'forward' | 'backward';
  /** Pista de dirección de "-up->", ".left.>"... relativa a source→target (para el layout, T3). */
  hint?: 'up' | 'down' | 'left' | 'right';
  /** Estilo de "-[#red,bold,dashed]->". */
  style?: { color?: string; bold?: boolean; dashed?: boolean };
  /** "A::campo --> B": miembro referenciado en cada extremo (source/target ya apuntan al tipo). */
  sourceMember?: string;
  targetMember?: string;
  /** "(A, B) .. C": id de la clase asociación de esta relación A–B. */
  associationClass?: string;
  line: number;
}

export type NotePosition = 'left' | 'right' | 'top' | 'bottom';

export interface NoteModel {
  /** Alias si es flotante; si no, "note_<línea>". */
  id: string;
  text: string;
  position?: NotePosition;
  /** id del tipo al que se ancla ("note left of A", "A .. N1"; en "note over A, B" el primero). */
  anchor?: string;
  /** Para "note on link": línea de la relación anterior. */
  linkLine?: number;
  line: number;
}

export interface PackageModel {
  /** Nombre real, p. ej. "x.domain". */
  name: string;
  /** ids de los tipos del paquete, ordenados. */
  typeIds: string[];
  /** Nombre de la capa contenedora, si existe (package "layer" as layer_N). */
  layer?: string;
}

export interface ParseIssue {
  /** 1-based */
  line: number;
  severity: 'error' | 'warning';
  message: string;
  /** Archivo de origen con !include; ausente = archivo de entrada. (T5) */
  file?: string;
  /** Línea en el texto combinado (para el snippet); line es en origen. (T5) */
  combinedLine?: number;
}

export interface DiagramModel {
  types: TypeNode[];
  relationships: RelationshipModel[];
  packages: PackageModel[];
  /** true si el .puml tenía "hide members" (modo resumen). */
  summaryMode: boolean;
  issues: ParseIssue[];
  /** Siempre presente tras parsePuml; opcional para los modelos armados a mano. */
  notes?: NoteModel[];
  /** Líneas hide/show/remove reconocidas, tal cual (las aplica T4). */
  hide?: string[];
  /** "left to right direction" = 'LR'; por defecto 'TB'. */
  direction?: 'TB' | 'LR';
  /** skinparam reconocidos (los soportados por T4), con la clave en minúsculas. */
  skinparams?: Record<string, string>;
}

/** Contadores para la sidebar. */
export interface CategoryCounts {
  sealed: number;
  abstract: number;
  interface: number;
  enum: number;
  record: number;
  annotation: number;
  class: number;
  /** Suma de las 7 categorías anteriores (tipos internos). */
  totalInternal: number;
  external: number;
  undeclared: number;
}

export interface SidebarGroup {
  category: Category;
  /** "Clases", "Sealed", ... */
  label: string;
  count: number;
  items: { id: string; name: string; packageName: string }[];
}
