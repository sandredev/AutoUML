// src/presentation/diagram/labels.ts — textos visibles del visor. src/render no depende del renderer: el host
// (RenderArea) los traduce con el módulo de localización y los pasa por props. Sin labels se usa el español por defecto.
// Son cadenas planas con marcadores {n}/{name}… para poder enviarlas al Worker si hace falta.
import type { ReportLabels } from '../../domain/analysis/report';
import type { Category, RelType } from '../../domain/diagram/model';
import type { PaletteActionLabels } from './palette/actions';

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
  // Atajos de teclado del canvas (T10.6)
  shortcutsTitle: string;
  shortcutsClose: string;
  shortcutsNav: string;
  shortcutsFocus: string;
  shortcutsEscape: string;
  shortcutsNavLinked: string;
  shortcutsNavRelation: string;
  relMode: string;
  relModeAll: string;
  shortcutsZoom: string;
  shortcutsFit: string;
  shortcutsHelp: string;
  // Ruta entre clases (T8)
  routeAria: string;
  /** "Ruta {from} → {to}: {n} saltos" */
  routeInfo: string;
  /** "No hay camino de {from} a {to}" */
  routeNone: string;
  routeDirected: string;
  routeClear: string;
  // Filtros (T8)
  filters: string;
  /** "Filtros ({n})": n filtros activos. */
  filtersActive: string;
  filtersTitle: string;
  filtersPanelAria: string;
  filtersRelations: string;
  filtersMembers: string;
  filtersMinVisibility: string;
  filtersVisAll: string;
  filtersVisPackage: string;
  filtersVisProtected: string;
  filtersVisPublic: string;
  filtersAccessors: string;
  filtersConstructors: string;
  filtersRelayoutHint: string;
  filtersClasses: string;
  filtersExternal: string;
  filtersUndeclared: string;
  /** "{n} clases ocultadas a mano" */
  filtersHiddenTypes: string;
  filtersShowTypes: string;
  filtersPackages: string;
  filtersAllPackages: string;
  filtersNoPackages: string;
  filtersClear: string;
  filtersClose: string;
  // Menú contextual (T8)
  menuAria: string;
  menuFocus: string;
  menuRouteFrom: string;
  menuCopyName: string;
  menuGoToCode: string;
  menuHideClass: string;
  menuHidePackage: string;
  /** "Plegar el paquete {name}" */
  menuCollapsePackage: string;
  menuExpandPackage: string;
  /** "Ocultar relaciones de tipo {type}" */
  menuHideRelType: string;
  menuFit: string;
  menuClearRoute: string;
  menuExitFocus: string;
  menuClearFilters: string;
  /** "Ruta desde {from}: haz clic en la clase de destino" */
  routePick: string;
  /** Diagnóstico de arquitectura (T9). */
  analysis: AnalysisLabels;
  /** Paleta de comandos (T10). */
  palette: PaletteLabels;
  /** Vistas de presentación (T10). */
  views: ViewsLabels;
}

/** Textos de la paleta de comandos (Ctrl+K). */
export interface PaletteLabels {
  title: string;
  placeholder: string;
  empty: string;
  /** "{n} resultados" (anunciado al teclear). */
  results: string;
  kindClass: string;
  kindPackage: string;
  kindAction: string;
  /** Acciones de la app (T10.2). */
  actions: PaletteActionLabels;
  hint: string;
  toolbar: string;
  toolbarTitle: string;
}

/** Textos de las vistas guardadas como diapositivas (T10). */
export interface ViewsLabels {
  toggle: string;
  toggleTitle: string;
  panelAria: string;
  saveHeading: string;
  titleLabel: string;
  /** Título por defecto: "Vista {n}". */
  defaultTitle: string;
  includeFilters: string;
  includeFocus: string;
  includeCollapsed: string;
  save: string;
  listHeading: string;
  empty: string;
  apply: string;
  remove: string;
  /** "Aplicar la vista «{title}»" */
  applyAria: string;
  removeAria: string;
  close: string;
  /** Recorrido a pantalla completa (T10.4). */
  present: string;
  presentTitle: string;
  rename: string;
  /** "Renombrar la vista «{title}»" */
  renameAria: string;
  moveUp: string;
  moveDown: string;
  /** "Subir la vista «{title}»" / "Bajar la vista «{title}»" */
  moveUpAria: string;
  moveDownAria: string;
  /** "{n} / {total}" */
  slide: string;
  presentHint: string;
  exitPresent: string;
}

/** Textos del diagnóstico de arquitectura (T9): los del informe Markdown más los del panel. */
export interface AnalysisLabels extends ReportLabels {
  toggle: string;
  toggleTitle: string;
  panelAria: string;
  heatmap: string;
  heatNone: string;
  heatFanIn: string;
  heatFanOut: string;
  heatInstability: string;
  /** "{metric}: de {min} (claro) a {max} (oscuro)" */
  legendRange: string;
  legendCycle: string;
  legendViolation: string;
  includeExternal: string;
  exportReport: string;
  exportTitle: string;
  close: string;
  /** "Ir a {name}" */
  goTo: string;
}

const DEFAULT_CATEGORIES: Record<Category, string> = {
  sealed: 'Clase sellada',
  abstract: 'Clase abstracta',
  interface: 'Interfaz',
  enum: 'Enumeración',
  record: 'Registro',
  annotation: 'Anotación',
  class: 'Clase',
  external: 'Externo',
  undeclared: 'Sin declarar',
};

export const DEFAULT_LABELS: ViewerLabels = {
  canvasAria:
    'Diagrama de clases. Arrastra una tarjeta para moverla o el fondo para mover la vista. Haz clic en el encabezado de un paquete para contraerlo y en su tarjeta para expandirlo. Con una clase seleccionada, F muestra solo ella y sus vecinos y Mayús+clic en otra clase marca la ruta más corta; ⌫ vuelve.',
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
  categories: DEFAULT_CATEGORIES,
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
  focusExitTitle: 'Volver al diagrama completo con la vista anterior (F sobre la misma clase o ⌫)',
  shortcutsTitle: 'Atajos de teclado',
  shortcutsClose: 'Cerrar',
  shortcutsNav: 'Ir a la clase más cercana en esa dirección',
  shortcutsNavLinked: 'Pulsar y soltar: activar/desactivar el modo relaciones (las flechas recorren la relación elegida: padre → comentario → hija)',
  relMode: 'Modo relaciones',
  relModeAll: 'todas',
  shortcutsNavRelation: 'En modo relaciones, elegir relación: ←/→ las recorren (arriba primero, luego abajo); ↑/↓ saltan a las de arriba/abajo',
  shortcutsFocus: 'Entrar en el foco de la selección; ya en foco, cambiar a otra o salir',
  shortcutsEscape: 'Deshacer por capas: ayuda, modo relaciones, ruta y foco; al final, ⌫ vuelve al diagrama completo encuadrado y Esc sale de pantalla completa',
  shortcutsZoom: 'Acercar / alejar',
  shortcutsFit: 'Ajustar la vista al diagrama',
  shortcutsHelp: 'Mostrar esta ayuda',
  routeAria: 'Ruta entre clases',
  routeInfo: 'Ruta {from} → {to}: {n} saltos',
  routeNone: 'No hay camino de {from} a {to}',
  routeDirected: 'Seguir el sentido de las relaciones',
  routeClear: 'Quitar ruta',
  filters: 'Filtros',
  filtersActive: 'Filtros ({n})',
  filtersTitle: 'Filtrar relaciones, miembros, clases y paquetes de este documento',
  filtersPanelAria: 'Filtros del diagrama',
  filtersRelations: 'Relaciones',
  filtersMembers: 'Miembros',
  filtersMinVisibility: 'Visibilidad mínima',
  filtersVisAll: 'Todos',
  filtersVisPackage: 'Paquete o más',
  filtersVisProtected: 'Protegidos o más',
  filtersVisPublic: 'Solo públicos',
  filtersAccessors: 'Ocultar getters y setters',
  filtersConstructors: 'Ocultar constructores',
  filtersRelayoutHint: 'Los filtros de miembros cambian el tamaño de las tarjetas y reorganizan el diagrama.',
  filtersClasses: 'Clases',
  filtersExternal: 'Ocultar externos',
  filtersUndeclared: 'Ocultar sin declarar',
  filtersHiddenTypes: '{n} clases ocultadas a mano',
  filtersShowTypes: 'Mostrarlas',
  filtersPackages: 'Paquetes',
  filtersAllPackages: 'Todos',
  filtersNoPackages: 'Ninguno',
  filtersClear: 'Quitar filtros',
  filtersClose: 'Cerrar',
  menuAria: 'Acciones del diagrama',
  menuFocus: 'Enfocar',
  menuRouteFrom: 'Ruta desde aquí…',
  menuCopyName: 'Copiar nombre',
  menuGoToCode: 'Ir al código',
  menuHideClass: 'Ocultar esta clase',
  menuHidePackage: 'Ocultar este paquete',
  menuCollapsePackage: 'Plegar el paquete {name}',
  menuExpandPackage: 'Desplegar el paquete',
  menuHideRelType: 'Ocultar relaciones de tipo {type}',
  menuFit: 'Encuadrar el diagrama',
  menuClearRoute: 'Quitar ruta',
  menuExitFocus: 'Salir del foco',
  menuClearFilters: 'Quitar filtros',
  routePick: 'Ruta desde {from}: haz clic en la clase de destino',
  palette: {
    title: 'Paleta de comandos',
    placeholder: 'Buscar clase, paquete o acción…',
    empty: 'Sin resultados',
    results: '{n} resultados',
    kindClass: 'Clase',
    kindPackage: 'Paquete',
    kindAction: 'Acción',
    actions: {
      exportPng: 'Exportar PNG',
      exportSvg: 'Exportar SVG',
      exportPdf: 'Exportar PDF',
      copyPng: 'Copiar PNG',
      collapseAll: 'Plegar todos los paquetes',
      expandAll: 'Desplegar todos los paquetes',
      clearFilters: 'Quitar filtros',
      theme: 'Tema: {name}',
    },
    hint: '↑↓ navegar · Enter ir · Esc cerrar',
    toolbar: 'Buscar',
    toolbarTitle: 'Buscar clases y paquetes (Ctrl+K)',
  },
  views: {
    toggle: 'Vistas',
    toggleTitle: 'Guardar y aplicar vistas del diagrama',
    panelAria: 'Vistas guardadas',
    saveHeading: 'Guardar la vista actual',
    titleLabel: 'Título',
    defaultTitle: 'Vista {n}',
    includeFilters: 'Incluir filtros',
    includeFocus: 'Incluir clase en foco',
    includeCollapsed: 'Incluir paquetes plegados',
    save: 'Guardar vista',
    listHeading: 'Vistas guardadas',
    empty: 'Aún no hay vistas guardadas.',
    apply: 'Aplicar',
    remove: 'Eliminar',
    applyAria: 'Aplicar la vista «{title}»',
    removeAria: 'Eliminar la vista «{title}»',
    close: 'Cerrar',
    present: 'Presentar',
    presentTitle: 'Recorrer las vistas a pantalla completa (←/→, Esc para salir)',
    rename: 'Renombrar',
    renameAria: 'Renombrar la vista «{title}»',
    moveUp: 'Subir',
    moveDown: 'Bajar',
    moveUpAria: 'Subir la vista «{title}»',
    moveDownAria: 'Bajar la vista «{title}»',
    slide: '{n} / {total}',
    presentHint: '←/→ cambiar de vista · Esc salir',
    exitPresent: 'Salir',
  },
  analysis: {
    title: '{title}: diagnóstico de arquitectura',
    summary: '{types} tipos analizados · {deps} dependencias.',
    excluded: 'No incluye tipos externos ni sin declarar.',
    cycles: 'Ciclos entre clases ({n})',
    packageCycles: 'Ciclos entre paquetes ({n})',
    selfLoops: 'Autorreferencias ({n})',
    cycleMembers: '{n} clases: {names}',
    none: 'Ninguno.',
    violations: 'Violaciones de capas ({n})',
    layersOrder: 'Capas de arriba abajo ({source}): {layers}.',
    layersFromConfig: 'layers.json',
    layersFromModel: 'paquetes del diagrama',
    layersNone: 'El diagrama no define capas: anida paquetes dentro de un paquete-capa o añade un layers.json junto al .puml.',
    layersRule: 'Una capa superior puede depender de una inferior; depender de una capa superior es una violación.',
    colSource: 'Origen',
    colTarget: 'Destino',
    colLayer: 'Capa',
    metrics: 'Métricas',
    byCategory: 'Tipos por categoría',
    colCategory: 'Categoría',
    colTypes: 'Tipos',
    inheritance: 'Herencia',
    inheritanceDepth: 'Profundidad máxima: {n}',
    topCoupled: 'Clases más acopladas',
    colClass: 'Clase',
    colCa: 'Ca (entrantes)',
    colCe: 'Ce (salientes)',
    colCaShort: 'Ca',
    colCeShort: 'Ce',
    colI: 'I',
    colA: 'A',
    colD: 'D',
    packages: 'Paquetes',
    colPackage: 'Paquete',
    colAbstract: 'Abstractos',
    legend: 'Ca: acoplamiento aferente (cuántas clases dependen de esta). Ce: eferente (de cuántas depende). I = Ce / (Ca + Ce). A = tipos abstractos / tipos. D = |A + I − 1|.',
    toggle: 'Análisis',
    toggleTitle: 'Mostrar ciclos, violaciones de capas, mapa de calor y métricas',
    panelAria: 'Diagnóstico de arquitectura',
    heatmap: 'Mapa de calor',
    heatNone: 'Sin colorear',
    heatFanIn: 'Fan-in (Ca)',
    heatFanOut: 'Fan-out (Ce)',
    heatInstability: 'Inestabilidad (I)',
    legendRange: '{metric}: de {min} (claro) a {max} (oscuro)',
    legendCycle: 'Ciclo (trazo doble)',
    legendViolation: 'Hacia capa superior (raya y punto)',
    includeExternal: 'Incluir externos y sin declarar',
    exportReport: 'Exportar informe…',
    exportTitle: 'Guardar este diagnóstico como Markdown',
    close: 'Cerrar',
    goTo: 'Ir a {name}',
    noPackage: '(sin paquete)',
    categories: DEFAULT_CATEGORIES,
  },
};

/** Sustituye los marcadores {clave} de una etiqueta. */
export function fill(template: string, params: Record<string, string | number>): string {
  let out = template;
  for (const [k, v] of Object.entries(params)) out = out.split('{' + k + '}').join(String(v));
  return out;
}
