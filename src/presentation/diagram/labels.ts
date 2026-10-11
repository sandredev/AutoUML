// src/presentation/diagram/labels.ts — textos visibles del visor. src/render no depende del renderer: el host
// (RenderArea) los traduce con el módulo de localización y los pasa por props. Sin labels se usa el español por defecto.
// Son cadenas planas con marcadores {n}/{name}… para poder enviarlas al Worker si hace falta.
import type { Category, RelType } from '../../domain/diagram/model';

export interface ViewerLabels {
  // Lienzo
  canvasAria: string;
  minimapAria: string;
  /** Prefijo del error de dibujo; el detalle va detrás. */
  paintError: string;
  /** Campo de renombrado en línea de una tarjeta (T7). */
  renameAria: string;
  contextUnavailable: string;
  /** "{n} entidades · clic para expandir" */
  collapsedSubtitle: string;
  /** "… +{n} más" */
  moreMembers: string;
  // Tooltip
  tipPackage: string;
  tipKind: string;
  /** "{in} entrantes · {out} salientes" */
  tipRelations: string;
  tipMultiplicity: string;
  tipLabel: string;
  /** "{n} entidades" */
  tipEntities: string;
  noPackage: string;
  categories: Record<Category, string>;
  relTypes: Record<RelType, string>;
  // Barra y estados de PumlViewer
  computeError: string;
  computing: string;
  emptyTitle: string;
  emptyBody: string;
  toolbarAria: string;
  relayouting: string;
  /** "Diseño de respaldo (dagre): {reason}" */
  fallback: string;
  fallbackBadge: string;
  manual: string;
  refining: string;
  reset: string;
  resetTitle: string;
  // Modo foco (T8)
  focus: string;
  focusTitle: string;
  focusGroupAria: string;
  /** "Foco: {name}" */
  focusOn: string;
  focusDepth: string;
  focusDirection: string;
  focusDirOut: string;
  focusDirIn: string;
  focusDirBoth: string;
  focusExit: string;
  focusExitTitle: string;
  // Ruta entre clases (T8)
  routeAria: string;
  /** "Ruta {from} → {to}: {n} saltos" */
  routeInfo: string;
  /** "No hay camino de {from} a {to}" */
  routeNone: string;
  routeDirected: string;
  routeClear: string;
}

export const DEFAULT_LABELS: ViewerLabels = {
  canvasAria:
    'Diagrama de clases. Arrastra una tarjeta para moverla o el fondo para mover la vista. Haz clic en el encabezado de un paquete para contraerlo y en su tarjeta para expandirlo. Con una clase seleccionada, F muestra solo ella y sus vecinos y Mayús+clic en otra clase marca la ruta más corta; Esc vuelve.',
  minimapAria: 'Minimapa del diagrama. Haz clic para centrar la vista, arrastra el recuadro o usa las flechas para desplazarla.',
  paintError: 'No se pudo dibujar el diagrama: ',
  renameAria: 'Nuevo nombre del tipo',
  contextUnavailable: 'no se pudo obtener el contexto 2D del lienzo.',
  collapsedSubtitle: '{n} entidades · clic para expandir',
  moreMembers: '… +{n} más',
  tipPackage: 'Paquete',
  tipKind: 'Tipo',
  tipRelations: '{in} entrantes · {out} salientes',
  tipMultiplicity: 'Multiplicidad',
  tipLabel: 'Etiqueta',
  tipEntities: '{n} entidades',
  noPackage: '(sin paquete)',
  categories: {
    sealed: 'Clase sellada',
    abstract: 'Clase abstracta',
    interface: 'Interfaz',
    enum: 'Enumeración',
    record: 'Registro',
    annotation: 'Anotación',
    class: 'Clase',
    external: 'Externo',
    undeclared: 'Sin declarar',
  },
  relTypes: {
    EXTENDS: 'Herencia',
    IMPLEMENTS: 'Implementación',
    ASSOCIATION: 'Asociación',
    DEPENDENCY: 'Dependencia',
    COMPOSITION: 'Composición',
    AGGREGATION: 'Agregación',
  },
  computeError: 'No se pudo calcular el diagrama',
  computing: 'Calculando diagrama…',
  emptyTitle: 'El diagrama está vacío',
  emptyBody: 'El archivo no contiene entidades reconocibles.',
  toolbarAria: 'Vista del diagrama',
  relayouting: 'Reorganizando…',
  fallback: 'Diseño de respaldo (dagre): {reason}',
  fallbackBadge: '⚠ respaldo',
  manual: 'Posiciones modificadas a mano',
  refining: 'refinando…',
  reset: 'Restablecer',
  resetTitle: 'Devolver las tarjetas a su posición inicial y reorganizar el diagrama',
  focus: 'Enfocar',
  focusTitle: 'Mostrar solo la clase seleccionada y sus vecinos (F)',
  focusGroupAria: 'Modo foco',
  focusOn: 'Foco: {name}',
  focusDepth: 'Saltos',
  focusDirection: 'Dirección',
  focusDirOut: 'Salientes',
  focusDirIn: 'Entrantes',
  focusDirBoth: 'Ambas',
  focusExit: 'Salir del foco',
  focusExitTitle: 'Volver al diagrama completo con la vista anterior (Esc)',
  routeAria: 'Ruta entre clases',
  routeInfo: 'Ruta {from} → {to}: {n} saltos',
  routeNone: 'No hay camino de {from} a {to}',
  routeDirected: 'Seguir el sentido de las relaciones',
  routeClear: 'Quitar ruta',
};

/** Sustituye los marcadores {clave} de una etiqueta. */
export function fill(template: string, params: Record<string, string | number>): string {
  let out = template;
  for (const [k, v] of Object.entries(params)) out = out.split('{' + k + '}').join(String(v));
  return out;
}
