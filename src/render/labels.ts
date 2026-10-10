// src/render/labels.ts — textos visibles del visor. src/render no depende del renderer: el host
// (RenderArea) los traduce con i18n y los pasa por props. Sin labels se usa el español por defecto.
// Son cadenas planas con marcadores {n}/{name}… para poder enviarlas al Worker si hace falta.
import type { Category, RelType } from '../core/model';

export interface ViewerLabels {
  // Lienzo
  canvasAria: string;
  minimapAria: string;
  /** Prefijo del error de dibujo; el detalle va detrás. */
  paintError: string;
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
}

export const DEFAULT_LABELS: ViewerLabels = {
  canvasAria:
    'Diagrama de clases. Arrastra una tarjeta para moverla o el fondo para mover la vista. Haz clic en el encabezado de un paquete para contraerlo y en su tarjeta para expandirlo.',
  minimapAria: 'Minimapa del diagrama. Haz clic para centrar la vista, arrastra el recuadro o usa las flechas para desplazarla.',
  paintError: 'No se pudo dibujar el diagrama: ',
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
};

/** Sustituye los marcadores {clave} de una etiqueta. */
export function fill(template: string, params: Record<string, string | number>): string {
  let out = template;
  for (const [k, v] of Object.entries(params)) out = out.split('{' + k + '}').join(String(v));
  return out;
}
