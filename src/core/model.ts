// Modelo interno del visualizador (copia de MODELO-DATOS.md). Sin lógica en la Fase 1.
// Módulo puro: sin dependencias de Electron ni de React.

/** Tipo primitivo declarado en el .puml (lo que dice la palabra clave). */
export type DeclaredKind = 'class' | 'abstract' | 'interface' | 'enum' | 'record' | 'annotation';

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

export type RelType = 'EXTENDS' | 'IMPLEMENTS' | 'ASSOCIATION' | 'DEPENDENCY';

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
}

export interface DiagramModel {
  types: TypeNode[];
  relationships: RelationshipModel[];
  packages: PackageModel[];
  /** true si el .puml tenía "hide members" (modo resumen). */
  summaryMode: boolean;
  issues: ParseIssue[];
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
