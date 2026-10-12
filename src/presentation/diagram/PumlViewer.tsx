import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode, RefObject } from 'react';
import { analyzeDiagram } from '../../domain/analysis/analyze';
import { analysisReport } from '../../domain/analysis/report';
import type { DiagramModel } from '../../domain/diagram/model';
import type { SidecarState } from '../../application/ports/ipc';
import { CommandPalette, type PaletteItem } from '../components/CommandPalette';
import { FullscreenIcon, MinusIcon, PlusIcon, ScanIcon, SearchIcon } from '../components/Icons';
import { MenuButton } from '../components/MenuButton';
import { AnalysisPanel } from './AnalysisPanel';
import { buildOverlay, type HeatMetric } from './analysis/overlay';
import { DiagramCanvas, type DiagramCanvasHandle } from './canvas/DiagramCanvas';
import { EMPTY_SELECTION } from './canvas/selection';
import type { MenuAction, MenuSubject } from './contextMenu';
import { FiltersPanel, withListItem } from './FiltersPanel';
import { focusTargetOf, focusToggle, isEditable, viewerShortcut } from './focusMode';
import { drawHiddenOf, hasActiveFilters, memberFiltersKey, type DiagramFilters } from './graph/filters';
import { focusKey, type FocusDirection, type FocusSpec } from './graph/neighborhood';
import { DEFAULT_LABELS, fill, type ViewerLabels } from './labels';
import { collapsedOwner, isPackageNode, PACKAGE_NODE_PREFIX, packageNodeName } from './layout/aggregate';
import { buildPaletteActions, type AppAction } from './palette/actions';
import { animatesTransition, clampIndex, presentationReducer, startPresentation, type PlayerEvent } from './presentation/player';
import { addView, moveView, removeView, renameView, type DeckView } from './presentation/views';
import { ViewsPanel, type SaveViewOptions } from './ViewsPanel';
import { useDiagramLayout } from './layout/useDiagramLayout';
import type { LayoutOptions, ViewState } from './types';
import { initialViewOptions, resetViewOptions, type ViewOptionsState } from './viewOptions';
import { hiddenByPuml, outOfViewOf, shownRelationsOf, type ViewerControl, type ViewerInfo } from './viewerInfo';

/** Acciones de la barra del visor que ejecuta la app (zoom, encuadre, exportar…). (T11) */
export interface ViewerToolbarHost {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onFullscreen: () => void;
  onRelayout: () => void;
  onExport: (kind: 'png' | 'svg' | 'pdf' | 'copy') => void;
}

/**
 * Electron-independent view for the puml-viewer capability. The host owns
 * project selection, PUML loading, and model parsing; this component owns
 * layout and drawing.
 */
/** Lo que la paleta necesita de la app para sus acciones (T10.2). */
export interface PaletteHost {
  themes: readonly { mode: string; name: string }[];
  onAppAction: (action: AppAction) => void;
  onTheme: (mode: string) => void;
}

export interface PumlViewerProps {
  model: DiagramModel | null;
  selectedId?: string | null;
  /** Selección completa (Ctrl+clic, marco). Siempre contiene `selectedId` si no es null. */
  selectedIds?: ReadonlySet<string>;
  onSelect?: (id: string | null, ids: ReadonlySet<string>) => void;
  canvasRef?: RefObject<DiagramCanvasHandle | null>;
  className?: string;
  /** Notifica cuando el layout empieza o termina de calcularse (la intro de carga lo usa). */
  onLayoutLoadingChange?: (loading: boolean) => void;
  /**
   * Identidad del documento (proyecto o ruta). Si el modelo cambia con el mismo docKey (recarga) se
   * sigue mostrando el diagrama, se conservan la vista y las posiciones manuales de los ids que sigan.
   */
  docKey?: string;
  /** Textos traducidos; sin ellos, español. */
  labels?: ViewerLabels;
  /** Estado persistido del sidecar (colapsados, overrides, vista). */
  initialSidecar?: SidecarState | null;
  /** Avisa cuando cambian colapsados, filtros (T8), vistas guardadas (T10), posiciones manuales o vista (para persistir). */
  onViewStateChange?: (collapsed: ReadonlySet<string>, filters: DiagramFilters, views: readonly DeckView[]) => void;
  /** Línea de una relación cuya arista se resalta (T7: cursor del editor). */
  highlightLine?: number | null;
  /** Clic en una arista: línea de su relación (T7). */
  onRelationSelect?: (line: number | null) => void;
  /** Renombrado en línea con doble clic (T7): mensaje de error o null si se aplicó. */
  onRename?: (id: string, next: string) => string | null;
  /** Menú contextual "Ir al código" (T8): un tipo o la línea de una relación. Sin él, la entrada sale deshabilitada. */
  onGoToCode?: (target: CodeTarget) => void;
  /** Menú contextual "Copiar nombre" (T8). */
  onCopyText?: (text: string) => void;
  /** Acciones de la app en la paleta (T10.2): exportar y tema. Sin él, solo las del visor. */
  paletteHost?: PaletteHost;
  /** Orden de capas de layers.json (T9); sin él, el de los paquetes del modelo. */
  analysisLayers?: readonly string[] | null;
  /** Título del informe de arquitectura (nombre del documento) (T9). */
  reportTitle?: string;
  /** Guarda el informe Markdown (T9). Sin él, el botón de exportar sale deshabilitado. */
  onExportReport?: (markdown: string) => void;
  /** Cada incremento restablece el visor: tarjetas a su posición inicial, opciones por defecto y encuadre. */
  resetSignal?: number;
  /** Barra del visor (T11): sin él no se muestran zoom, encuadre, disposición ni exportar. */
  toolbarHost?: ViewerToolbarHost;
  /** Qué se ve del documento (T11): conteos de la barra de estado y bloque "Fuera de la vista". */
  onViewInfo?: (info: ViewerInfo) => void;
  /** Mandos del visor que usa la app (T11). */
  controlRef?: RefObject<ViewerControl | null>;
  /** Aviso fijo sobre el lienzo (p. ej. "se muestra el último diagrama válido"). */
  banner?: ReactNode;
}

export type CodeTarget = { kind: 'type'; id: string } | { kind: 'relation'; line: number };

const NO_COLLAPSED: ReadonlySet<string> = new Set();
const NO_FILTERS: DiagramFilters = {};
const NO_VIEWS: readonly DeckView[] = [];
const FOCUS_DEPTHS = [1, 2, 3] as const;
const FOCUS_DIRECTIONS: FocusDirection[] = ['both', 'out', 'in'];

export function PumlViewer({
  model,
  selectedId = null,
  selectedIds,
  onSelect,
  canvasRef,
  className = '',
  onLayoutLoadingChange,
  docKey,
  labels = DEFAULT_LABELS,
  initialSidecar,
  onViewStateChange,
  highlightLine = null,
  onRelationSelect,
  onRename,
  onGoToCode,
  onCopyText,
  paletteHost,
  analysisLayers = null,
  reportTitle = '',
  onExportReport,
  resetSignal = 0,
  toolbarHost,
  onViewInfo,
  controlRef,
  banner,
}: PumlViewerProps): JSX.Element {
  const [view, setView] = useState<ViewOptionsState>(initialViewOptions);
  const [manual, setManual] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(NO_COLLAPSED);
  // Modo foco (T8): clase (o paquete plegado) y sus vecinos a N saltos. focusAnimate: la cámara vuela al
  // entrar/salir salvo si lo pidió el teclado.
  const [focus, setFocus] = useState<FocusSpec | null>(null);
  const [focusAnimate, setFocusAnimate] = useState(false);
  // Filtros semánticos (T8), por documento: llegan con el sidecar y se persisten con él.
  const [filters, setFilters] = useState<DiagramFilters>(NO_FILTERS);
  // Vistas guardadas como diapositivas (T10), por documento: también viajan con el sidecar.
  const [views, setViews] = useState<readonly DeckView[]>(NO_VIEWS);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Vista guardada aplicada (T11): su nombre se muestra mientras sus filtros sigan siendo los actuales.
  const [appliedView, setAppliedView] = useState<{ title: string; filters: string } | null>(null);
  const [zoom, setZoom] = useState(100);
  // Diagnóstico de arquitectura (T9): capa opcional de SOLO dibujo. Se calcula sobre el documento entero
  // (no sobre lo filtrado o enfocado) y no entra en useDiagramLayout: activarla no recalcula posiciones.
  const [analysisOn, setAnalysisOn] = useState(false);
  const [heatMetric, setHeatMetric] = useState<HeatMetric>('none');
  const [includeExternal, setIncludeExternal] = useState(false);

  // Al cambiar de documento se parte de cero; al llegar el sidecar se aplican sus
  // colapsados (filtrados a los existentes). Se deriva durante el render.
  const sidecarKey = docKey ?? null;
  const lastKeyFor = useRef<string | null>(null);
  const lastAppliedSidecar = useRef<SidecarState | null | undefined>(undefined);
  if (sidecarKey !== lastKeyFor.current) {
    lastKeyFor.current = sidecarKey;
    lastAppliedSidecar.current = undefined;
    setCollapsed(NO_COLLAPSED);
    setFocus(null);
    setFilters(NO_FILTERS);
    setViews(NO_VIEWS);
    setPaletteOpen(false);
    setAppliedView(null);
  }
  if (sidecarKey !== null && initialSidecar !== undefined && lastAppliedSidecar.current !== initialSidecar) {
    lastAppliedSidecar.current = initialSidecar;
    const known = model ? new Set(model.packages.map((p) => p.name)) : null;
    setCollapsed(new Set((initialSidecar?.collapsed ?? []).filter((name) => !known || known.has(name))));
    setFilters(initialSidecar?.filters ?? NO_FILTERS);
    setViews(initialSidecar?.views ?? NO_VIEWS);
  }

  // Paquetes plegados que siguen existiendo en el modelo (derivado: sin efecto ni render extra).
  const liveCollapsed = useMemo(() => {
    if (!model || collapsed.size === 0) return NO_COLLAPSED;
    const known = new Set(model.packages.map((p) => p.name));
    const next = new Set([...collapsed].filter((name) => known.has(name)));
    return next.size === collapsed.size ? collapsed : next;
  }, [model, collapsed]);

  const moreTemplate = labels.moreMembers;
  const options = useMemo<LayoutOptions>(() => ({ ...view.options, moreTemplate }), [view.options, moreTemplate]);
  const {
    layout, layoutModel, viewModel, packageCounts, display, loading, error, fallback, ms, focusableModel, focusApplied,
  } = useDiagramLayout(model, liveCollapsed, options, view.layoutVersion, focus, filters);
  // Filtros de dibujo sobre el modelo que se dibuja (no recalculan el layout).
  const drawHidden = useMemo(() => (viewModel ? drawHiddenOf(viewModel, filters) : null), [viewModel, filters]);
  // Paquetes del documento para las casillas del panel.
  const packageNames = useMemo(
    () => (model ? [...new Set(model.packages.map((p) => p.name))].sort((a, b) => a.localeCompare(b)) : []),
    [model],
  );

  const analysis = useMemo(
    () => (analysisOn && model ? analyzeDiagram(model, { includeExternal, layers: analysisLayers }) : null),
    [analysisOn, model, includeExternal, analysisLayers],
  );
  const overlay = useMemo(() => (analysis ? buildOverlay(analysis, heatMetric) : null), [analysis, heatMetric]);

  // El objetivo del foco desapareció (recarga, plegado de su paquete…): se vuelve al diagrama completo.
  if (focus !== null && focusableModel !== null && !focusApplied) setFocus(null);
  const activeFocus = focus !== null && focusApplied ? focus : null;
  const focusTarget = model && focusableModel ? focusTargetOf(selectedId, focusableModel, model, liveCollapsed) : null;

  // Últimos valores para el atajo de teclado (el listener se registra una vez).
  const keyState = useRef({ focusTarget, activeFocus });
  keyState.current = { focusTarget, activeFocus };

  /** Enfoca `id` (o lo vuelve a enfocar si ya hay foco), conservando saltos y dirección. */
  const focusOn = useCallback((id: string, animate: boolean) => {
    setFocusAnimate(animate);
    setFocus((prev) => ({ id, depth: prev?.depth ?? 1, direction: prev?.direction ?? 'both' }));
  }, []);
  /** Enfoca la selección. */
  const enterFocus = useCallback((animate: boolean): boolean => {
    const id = keyState.current.focusTarget;
    if (id === null) return false;
    focusOn(id, animate);
    return true;
  }, [focusOn]);
  const exitFocus = useCallback((animate: boolean) => {
    setFocusAnimate(animate);
    setFocus(null);
  }, []);
  const changeFocus = useCallback((patch: Partial<FocusSpec>) => {
    setFocusAnimate(true);
    setFocus((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  // Documento de cada modelo recibido: un layout del modelo anterior sigue valiendo si es el mismo documento.
  const docOf = useRef(new WeakMap<DiagramModel, string>());
  if (model && docKey !== undefined && !docOf.current.has(model)) docOf.current.set(model, docKey);

  useEffect(() => {
    onLayoutLoadingChange?.(loading);
  }, [loading, onLayoutLoadingChange]);
  useEffect(() => () => onLayoutLoadingChange?.(false), [onLayoutLoadingChange]);
  const classes = `puml-viewer ${className}`.trim();

  // Si el host no pasa un ref, se usa uno propio para poder restablecer.
  const ownRef = useRef<DiagramCanvasHandle | null>(null);
  const handleRef = canvasRef ?? ownRef;

  // F entra en el foco de la selección; ya en foco, cambia a la nueva selección o, si es la misma, sale.
  // Esc / Retroceso deshacen por capas: quita la ruta, luego sale del foco y, sin nada más, Retroceso quita la
  // selección y encuadra (Esc sale de pantalla completa). Las tarjetas movidas a mano no se tocan aquí: se
  // devuelven con Ctrl+Shift+L. La ayuda y el modo relaciones los cierra antes el lienzo.
  // Atajos de alta frecuencia: la cámara no vuela (la transición del layout sí). No actúan escribiendo ni
  // con un diálogo modal abierto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const shortcut = viewerShortcut(e);
      if (shortcut === null || document.querySelector('[aria-modal="true"]')) return;
      const { activeFocus: current, focusTarget: target } = keyState.current;
      if (shortcut === 'toggle-focus') {
        const action = focusToggle(current?.id ?? null, target);
        if (action === null) return;
        e.preventDefault();
        if (action === 'exit') exitFocus(false);
        else enterFocus(false);
        return;
      }
      if (handleRef.current?.clearRoute()) {
        e.preventDefault();
        return;
      }
      if (current !== null) {
        e.preventDefault();
        exitFocus(false);
        return;
      }
      // Última capa de Retroceso: el diagrama en su estado normal (sin selección y encuadrado completo).
      if (shortcut === 'back') {
        e.preventDefault();
        selectRef.current?.(null, EMPTY_SELECTION);
        handleRef.current?.fit({ animate: true });
        // Sin aro de foco naranja en el lienzo hasta la siguiente tecla (distinta de Retroceso) o clic.
        rootRef.current?.classList.add('is-reset');
        return;
      }
      // Última capa de Esc: en pantalla completa, salir de ella (en ventana, nada).
      if (document.fullscreenElement) {
        e.preventDefault();
        void document.exitFullscreen().catch(() => undefined);
      }
    };
    const clearReset = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.key === 'Backspace') return;
      rootRef.current?.classList.remove('is-reset');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', clearReset, true);
    window.addEventListener('pointerdown', clearReset, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', clearReset, true);
      window.removeEventListener('pointerdown', clearReset, true);
    };
  }, [enterFocus, exitFocus, handleRef]);

  // Reset por señal (recarga): tarjetas a su posición, opciones por defecto y layout recalculado (layoutVersion++).
  // Reencuadra cuando llega el layout nuevo: encuadrar antes lo haría sobre el viejo.
  const lastResetSignal = useRef(resetSignal);
  const fitAfterLayoutFrom = useRef<typeof layout | undefined>(undefined);
  useEffect(() => {
    if (lastResetSignal.current === resetSignal) return;
    lastResetSignal.current = resetSignal;
    handleRef.current?.resetPositions();
    fitAfterLayoutFrom.current = layout;
    setView((v) => resetViewOptions(v));
  }, [resetSignal, handleRef, layout]);
  useEffect(() => {
    if (fitAfterLayoutFrom.current === undefined || loading || layout === fitAfterLayoutFrom.current) return;
    fitAfterLayoutFrom.current = undefined;
    handleRef.current?.fit({ animate: false });
  }, [layout, loading, handleRef]);

  const handleCollapsed = useCallback((next: Set<string>) => setCollapsed(next), []);

  // Acciones del menú contextual que no son del lienzo (T8).
  const hostRef = useRef({ onGoToCode, onCopyText });
  hostRef.current = { onGoToCode, onCopyText };
  const handleMenuAction = useCallback((action: MenuAction, subject: MenuSubject) => {
    const host = hostRef.current;
    switch (action) {
      case 'focus':
        if (subject.kind === 'node' || subject.kind === 'package') focusOn(subject.id, true);
        break;
      case 'exit-focus':
        exitFocus(true);
        break;
      case 'hide-node':
        if (subject.kind === 'node') setFilters((f) => ({ ...f, hiddenTypes: withListItem(f.hiddenTypes, subject.id, true) }));
        else if (subject.kind === 'package') setFilters((f) => ({ ...f, hiddenPackages: withListItem(f.hiddenPackages, subject.name, true) }));
        break;
      case 'hide-rel-type':
        if (subject.kind === 'edge') setFilters((f) => ({ ...f, hiddenRelTypes: withListItem(f.hiddenRelTypes, subject.relType, true) }));
        break;
      case 'clear-filters':
        setFilters(NO_FILTERS);
        break;
      case 'copy-name':
        if (subject.kind !== 'background') host.onCopyText?.(subject.name);
        break;
      case 'go-to-code':
        if (subject.kind === 'node') host.onGoToCode?.({ kind: 'type', id: subject.id });
        else if (subject.kind === 'edge' && subject.line !== null) host.onGoToCode?.({ kind: 'relation', line: subject.line });
        break;
      default:
        break;
    }
  }, [focusOn, exitFocus]);
  const filtersActive = hasActiveFilters(filters);
  const analysisPanelId = useId();

  // Panel de análisis: llevar la cámara a una clase (vuela con ratón; salta con teclado) y seleccionarla.
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const goToClass = useCallback((id: string, animate: boolean) => {
    handleRef.current?.focusNode(id, { animate });
    selectRef.current?.(id, new Set([id]));
  }, [handleRef]);
  const closeAnalysis = useCallback(() => setAnalysisOn(false), []);

  // Paleta de comandos (T10): Ctrl+K. Al cerrar, el foco vuelve a donde estaba.
  const paletteReturnFocus = useRef<HTMLElement | null>(null);
  const openPalette = useCallback(() => {
    paletteReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    paletteReturnFocus.current?.focus();
    paletteReturnFocus.current = null;
  }, []);
  // Ctrl+K alterna: cerrar por aquí también devuelve el foco (si no, queda en body y el lienzo no oye teclas).
  const paletteOpenRef = useRef(paletteOpen);
  paletteOpenRef.current = paletteOpen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      if (paletteOpenRef.current) closePalette();
      else openPalette();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPalette, closePalette]);
  const paletteItems = useMemo<PaletteItem[]>(() => {
    if (!model) return [];
    const classes = model.types.map((t): PaletteItem => ({ id: t.id, label: t.name, kind: 'class', detail: t.packageName }));
    const packages = packageNames.map((name): PaletteItem => ({ id: name, label: name, kind: 'package' }));
    return [...packages, ...classes];
  }, [model, packageNames]);
  const hostApp = paletteHost;
  const actionItems = useMemo<PaletteItem[]>(() => {
    if (!model) return [];
    const collapsible = packageNames.filter((n) => n !== '(default package)');
    const sel = selectedId !== null && selectedId !== undefined ? model.types.find((t) => t.id === selectedId) : undefined;
    const run = (fn: () => void) => () => fn();
    const actions = buildPaletteActions({
      labels: labels.palette.actions,
      viewerLabels: labels,
      themes: hostApp?.themes ?? [],
      hasDocument: hostApp !== undefined,
      packageCount: collapsible.length,
      collapsedCount: liveCollapsed.size,
      hasFilters: filtersActive,
      focused: sel ? { kind: 'node', id: sel.id, name: sel.name, packageName: sel.packageName } : null,
      menuContext: { canGoToCode: onGoToCode !== undefined, hasRoute: false, inFocus: activeFocus !== null, hasFilters: filtersActive },
      host: {
        app: (a) => hostApp?.onAppAction(a),
        context: (a, s) => handleRef.current?.runMenuAction(a, s),
        collapseAll: run(() => setCollapsed(new Set(collapsible))),
        expandAll: run(() => setCollapsed(NO_COLLAPSED)),
        clearFilters: run(() => setFilters(NO_FILTERS)),
        theme: (m) => hostApp?.onTheme(m),
      },
    });
    return actions
      .filter((a) => a.enabled)
      .map((a): PaletteItem => ({ id: a.id, label: a.label, kind: 'action', ...(a.detail ? { detail: a.detail } : {}), run: a.run }));
  }, [model, packageNames, selectedId, labels, hostApp, liveCollapsed, filtersActive, onGoToCode, activeFocus, handleRef]);
  // Acciones primero: con la consulta vacía la lista se corta y, al final, nadie las descubriría.
  const allPaletteItems = useMemo(() => [...actionItems, ...paletteItems], [paletteItems, actionItems]);
  const pickPaletteItem = useCallback((item: PaletteItem) => {
    closePalette();
    if (item.kind === 'action') {
      item.run?.();
      return;
    }
    const canvas = handleRef.current;
    if (item.kind === 'class') {
      goToClass(item.id, true);
      return;
    }
    // Paquete plegado (o dentro de uno): se lleva la cámara a su tarjeta agregada.
    const owner = collapsedOwner(item.id, liveCollapsed);
    if (owner !== null) canvas?.focusNode(PACKAGE_NODE_PREFIX + owner, { animate: true });
    else if (!canvas?.fitPackage(item.id, { animate: true })) canvas?.fit();
  }, [closePalette, goToClass, handleRef, liveCollapsed]);

  // Vistas guardadas (T10): cámara + filtros, foco y plegados opcionales.
  const saveView = useCallback((o: SaveViewOptions) => {
    const canvas = handleRef.current;
    if (!canvas) return;
    const withFocus = o.includeFocus && activeFocus !== null;
    // Con foco se guarda la cámara que se ve; sin él, la del diagrama completo (al aplicarla se sale del foco).
    const cam = canvas.getCamera();
    const view = withFocus ? cam.view : canvas.getSnapshot().view;
    const v: DeckView = { title: o.title, view: { ...view }, frame: cam.frame };
    // Sin filtros ni plegados también se guardan (vacíos): la cámara es de ese layout. Ausentes = el usuario
    // los desmarcó y la vista no los toca.
    if (o.includeFilters || !hasActiveFilters(filters)) v.filters = filters;
    if (withFocus) v.focusKey = activeFocus.id;
    if (o.includeCollapsed || liveCollapsed.size === 0) v.collapsed = [...liveCollapsed];
    setViews((prev) => addView(prev, v));
  }, [handleRef, filters, activeFocus, liveCollapsed]);
  const removeSavedView = useCallback((index: number) => setViews((prev) => removeView(prev, index)), []);
  const renameSavedView = useCallback((index: number, title: string) => setViews((prev) => renameView(prev, index, title)), []);
  const moveSavedView = useCallback((from: number, to: number) => setViews((prev) => moveView(prev, from, to)), []);
  const applyView = useCallback((index: number, animate = true) => {
    const v = views[index];
    if (!v) return;
    const known = model ? new Set(model.packages.map((p) => p.name)) : null;
    const nextCollapsed = v.collapsed ? new Set(v.collapsed.filter((n) => !known || known.has(n))) : null;
    const collapsedChanges = nextCollapsed !== null
      && (nextCollapsed.size !== liveCollapsed.size || [...nextCollapsed].some((n) => !liveCollapsed.has(n)));
    const filtersChange = v.filters !== undefined && memberFiltersKey(v.filters) !== memberFiltersKey(filters);
    // Una clase que ya no existe no se enfoca: el foco no cambiaría y la cámara quedaría esperando un layout.
    const focusKnown = v.focusKey !== undefined && (!model || model.types.some((t) => t.id === v.focusKey));
    const focusChanges = focusKnown && v.focusKey !== activeFocus?.id;
    // Una vista sin foco se guardó sobre el diagrama completo: con un foco activo, su cámara caería en el subgrafo.
    const leavesFocus = v.focusKey === undefined && activeFocus !== null;
    // Si el layout va a cambiar, la cámara espera al layout nuevo; si el foco cambia, el foco reencuadra.
    handleRef.current?.goToView(v.view, {
      animate,
      afterLayout: collapsedChanges || filtersChange || focusChanges || leavesFocus,
      ...(v.frame ? { frame: v.frame } : {}),
    });
    if (nextCollapsed !== null && collapsedChanges) setCollapsed(nextCollapsed);
    if (v.filters !== undefined) setFilters(v.filters);
    setAppliedView({ title: v.title, filters: JSON.stringify(v.filters ?? filters) });
    if (leavesFocus) exitFocus(animate);
    else if (v.focusKey !== undefined && focusChanges) focusOn(v.focusKey, true);
  }, [views, model, liveCollapsed, filters, activeFocus, handleRef, focusOn, exitFocus]);

  // Recorrido de presentación (T10.4): pantalla completa del visor y ←/→ entre vistas. El estado vive en
  // `player`; aplicar la vista y la pantalla completa son efectos de aquí.
  const rootRef = useRef<HTMLElement | null>(null);
  const [player, setPlayer] = useState<ReturnType<typeof startPresentation> | null>(null);
  const playing = player !== null && player.active;
  const dispatchPlayer = useCallback((e: PlayerEvent) => {
    setPlayer((p) => (p ? presentationReducer(p, e) : p));
  }, []);
  const present = useCallback(() => {
    if (views.length === 0) return;
    setPlayer(startPresentation(views.length));
    void rootRef.current?.requestFullscreen?.().catch(() => undefined);
  }, [views]);
  const exitPresent = useCallback(() => {
    setPlayer(null);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);
  // La vista del recorrido sigue a la lista (renombrar/borrar desde el panel o el recorrido).
  const appliedIndex = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) {
      appliedIndex.current = null;
      return;
    }
    if (appliedIndex.current === player.index) return;
    const first = appliedIndex.current === null;
    appliedIndex.current = player.index;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    applyView(player.index, !first && animatesTransition(reduced));
  }, [playing, player, applyView]);
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent): void => {
      // Escribiendo (renombrar una vista, paleta de comandos): las teclas son del campo, no del recorrido.
      if (isEditable(e.target)) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        dispatchPlayer({ type: e.key === 'ArrowRight' ? 'next' : 'prev', count: viewsRef.current.length });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        exitPresent();
      }
    };
    const onFullscreen = (): void => {
      if (!document.fullscreenElement) setPlayer(null);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [playing, dispatchPlayer, exitPresent]);
  // Entrar o salir de pantalla completa con teclado (F11) deja el lienzo enfocado "por teclado" y saldría el aro
  // naranja; con el clic en el botón no. Mismo trato que el reset: sin aro hasta la siguiente tecla o clic.
  useEffect(() => {
    const onFullscreen = (): void => rootRef.current?.classList.add('is-reset');
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);
  // El panel sigue editable durante el recorrido: la lista del recorrido se mantiene al día.
  const viewsRef = useRef(views);
  viewsRef.current = views;
  useEffect(() => {
    setPlayer((p) => (p && p.index !== clampIndex(p.index, views.length) ? { ...p, index: clampIndex(p.index, views.length) } : p));
  }, [views]);
  // Si se borran las vistas desde el panel con el recorrido activo, se sale.
  if (playing && views.length === 0) setPlayer(null);

  const exportReport = useMemo(() => {
    if (!onExportReport || !model || !analysis) return undefined;
    return () => onExportReport(analysisReport(model, analysis, labels.analysis, reportTitle, { includeExternal }));
  }, [onExportReport, model, analysis, labels.analysis, reportTitle, includeExternal]);
  const canGoToCode = onGoToCode !== undefined;
  const menuContext = useMemo(() => ({ canGoToCode, hasFilters: filtersActive }), [canGoToCode, filtersActive]);

  // Aviso al host para persistir el sidecar (colapsados, posiciones manuales o vista).
  // El host lee el snapshot del canvas al guardar; aquí solo se le despierta (él hace debounce).
  const notifyRef = useRef(onViewStateChange);
  notifyRef.current = onViewStateChange;
  const persistRef = useRef({ collapsed: liveCollapsed, filters, views });
  persistRef.current = { collapsed: liveCollapsed, filters, views };
  const notify = useCallback(() => {
    notifyRef.current?.(persistRef.current.collapsed, persistRef.current.filters, persistRef.current.views);
  }, []);
  useEffect(() => {
    notify();
  }, [liveCollapsed, filters, views, notify]);
  const handleManualPositions = useCallback((has: boolean) => {
    setManual(has);
    notify();
  }, [notify]);
  const handleViewChange = useCallback((v: ViewState) => {
    setZoom(Math.round(v.scale * 100));
    notify();
  }, [notify]);

  // Lo que se ve (T11): la app lo usa en la barra de estado y en la lista de entidades.
  const outOfView = useMemo(
    () => (model && viewModel ? outOfViewOf(model, viewModel, drawHidden, liveCollapsed) : null),
    [model, viewModel, drawHidden, liveCollapsed],
  );
  const viewName = appliedView !== null && appliedView.filters === JSON.stringify(filters) ? appliedView.title : null;
  const narrowed = filtersActive || activeFocus !== null;
  const infoRef = useRef(onViewInfo);
  infoRef.current = onViewInfo;
  useEffect(() => {
    if (!model || !viewModel || !outOfView) return;
    infoRef.current?.({
      totalTypes: model.types.length,
      shownTypes: model.types.length - outOfView.size,
      totalRelations: model.relationships.length,
      shownRelations: shownRelationsOf(viewModel, drawHidden),
      outOfView,
      viewName,
      narrowed,
      zoom,
      fallback: fallback ?? null,
      layoutMs: ms ?? null,
    });
  }, [model, viewModel, outOfView, drawHidden, viewName, narrowed, zoom, fallback, ms]);

  // Mandos para la app (T11): el ojo de la lista, "Mostrar todo" y reintentar el layout.
  const pumlHidden = useMemo(() => (model ? hiddenByPuml(model, null) : new Map<string, number | null>()), [model]);
  const ctrlState = useRef({ model, activeFocus, pumlHidden });
  ctrlState.current = { model, activeFocus, pumlHidden };
  const showAll = useCallback(() => {
    setFilters(NO_FILTERS);
    setAppliedView(null);
    exitFocus(true);
  }, [exitFocus]);
  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = {
      setTypeVisible: (id, visible) => {
        const { model: m, activeFocus: foc } = ctrlState.current;
        const t = m?.types.find((x) => x.id === id);
        if (!t) return false;
        if (!visible) {
          setFilters((prev) => ({ ...prev, hiddenTypes: withListItem(prev.hiddenTypes, id, true) }));
          return true;
        }
        // Lo oculta el propio .puml (hide): la interfaz no puede mostrarlo.
        if (ctrlState.current.pumlHidden.has(id)) return false;
        setFilters((prev) => {
          const next: DiagramFilters = { ...prev, hiddenTypes: withListItem(prev.hiddenTypes, id, false) };
          if ((prev.hiddenPackages ?? []).includes(t.packageName)) next.hiddenPackages = withListItem(prev.hiddenPackages, t.packageName, false);
          if (prev.hideExternal && t.category === 'external') next.hideExternal = false;
          if (prev.hideUndeclared && t.category === 'undeclared') next.hideUndeclared = false;
          return next;
        });
        if (foc !== null) exitFocus(true);
        return true;
      },
      showAll,
      retryLayout: () => setView((v) => resetViewOptions(v)),
    };
    return () => {
      controlRef.current = null;
    };
  }, [controlRef, showAll, exitFocus]);

  if (error) {
    return (
      <section className={classes}>
        <h2 className="render-title">{labels.computeError}</h2>
        <p className="render-meta" role="alert">{error}</p>
      </section>
    );
  }

  // Mientras se recalcula el MISMO modelo (p. ej. tras "Restablecer" o al plegar) o el mismo documento
  // (recarga) se sigue mostrando el diagrama anterior.
  const sameDoc = docKey !== undefined && layoutModel !== null && docOf.current.get(layoutModel) === docKey;
  const showable = model !== null && layout !== null && viewModel !== null && (layoutModel === model || sameDoc);
  if (!showable) {
    return (
      <section className={classes}>
        <p className="render-meta" role="status">{labels.computing}</p>
      </section>
    );
  }

  if (layout.nodes.length === 0) {
    return (
      <section className={classes}>
        <h2 className="render-title">{labels.emptyTitle}</h2>
        <p className="render-meta">{labels.emptyBody}</p>
      </section>
    );
  }

  const directionLabel: Record<FocusDirection, string> = { both: labels.focusDirBoth, out: labels.focusDirOut, in: labels.focusDirIn };
  const focusName = (id: string): string =>
    isPackageNode(id) ? packageNodeName(id) : (model.types.find((t) => t.id === id)?.name ?? id);

  const tb = labels.toolbar;
  // Aviso de vista sobre el lienzo (T11): nombre de la vista o filtros/foco, con "Mostrar todo". Los totales van
  // en la barra de estado.
  const chipText = viewName !== null
    ? <>{tb.view} <strong>{viewName}</strong></>
    : activeFocus !== null
      ? fill(tb.focused, { name: focusName(activeFocus.id) })
      : filtersActive ? tb.filtered : null;
  const chip = chipText !== null ? (
    <div className="view-chip" role="status">
      <span>{chipText}</span>
      <button type="button" className="ghost-btn" onClick={showAll}>{tb.showAll}</button>
    </div>
  ) : null;

  return (
    <section ref={rootRef} className={`${classes} has-canvas`}>
      <div className="puml-viewer-bar" role="toolbar" aria-label={labels.toolbarAria}>
        <button
          type="button"
          className="tool-btn"
          title={tb.palette}
          aria-label={tb.palette}
          aria-keyshortcuts="Control+K"
          aria-haspopup="dialog"
          onClick={openPalette}
        >
          <SearchIcon />
        </button>
        <span className="toolbar-sep" aria-hidden="true" />
        <ViewsPanel
          views={views}
          labels={labels.views}
          hasFilters={filtersActive}
          hasFocus={activeFocus !== null}
          hasCollapsed={liveCollapsed.size > 0}
          onSave={saveView}
          onApply={applyView}
          onRemove={removeSavedView}
          onRename={renameSavedView}
          onMove={moveSavedView}
          onPresent={present}
        />
        <FiltersPanel filters={filters} packages={packageNames} labels={labels} onChange={setFilters} />
        <button
          type="button"
          className={analysisOn ? 'puml-viewer-reset is-active' : 'puml-viewer-reset'}
          aria-pressed={analysisOn}
          aria-controls={analysisOn ? analysisPanelId : undefined}
          title={labels.analysis.toggleTitle}
          onClick={() => setAnalysisOn((v) => !v)}
        >
          {labels.analysis.toggle}
        </button>
        {activeFocus !== null ? (
          <div className="puml-viewer-focus" role="group" aria-label={labels.focusGroupAria}>
            <span className="puml-viewer-focus-name">{fill(labels.focusOn, { name: focusName(activeFocus.id) })}</span>
            <label>
              {labels.focusDepth}
              <select value={activeFocus.depth} onChange={(e) => changeFocus({ depth: Number(e.target.value) })}>
                {FOCUS_DEPTHS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label>
              {labels.focusDirection}
              <select value={activeFocus.direction} onChange={(e) => changeFocus({ direction: e.target.value as FocusDirection })}>
                {FOCUS_DIRECTIONS.map((d) => <option key={d} value={d}>{directionLabel[d]}</option>)}
              </select>
            </label>
            <button type="button" className="puml-viewer-reset" onClick={() => exitFocus(true)} title={labels.focusExitTitle} aria-keyshortcuts="F Escape Backspace">
              {labels.focusExit}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="puml-viewer-reset"
            onClick={() => enterFocus(true)}
            aria-disabled={focusTarget === null}
            title={labels.focusTitle}
            aria-keyshortcuts="F"
          >
            {labels.focus}
          </button>
        )}
        <span className="puml-viewer-bar-info" aria-live="polite">{loading ? labels.relayouting : manual ? labels.manual : ''}</span>
        {toolbarHost && (
          <>
            <button type="button" className="tool-btn" title={tb.zoomOut} aria-label={tb.zoomOut} onClick={toolbarHost.onZoomOut}><MinusIcon /></button>
            <span className="puml-viewer-zoom" aria-label={tb.zoomLevel}>{zoom} %</span>
            <button type="button" className="tool-btn" title={tb.zoomIn} aria-label={tb.zoomIn} onClick={toolbarHost.onZoomIn}><PlusIcon /></button>
            <button type="button" className="tool-btn" title={tb.fit} aria-label={tb.fit} onClick={toolbarHost.onFit}><ScanIcon /></button>
            <button type="button" className="tool-btn" title={tb.fullscreen} aria-label={tb.fullscreen} onClick={toolbarHost.onFullscreen}><FullscreenIcon /></button>
            <button type="button" className="puml-viewer-reset" title={tb.relayoutTitle} onClick={toolbarHost.onRelayout}>{tb.relayout}</button>
            <span className="toolbar-sep" aria-hidden="true" />
            <MenuButton
              className="export-menu"
              label={tb.exportLabel}
              alignEnd
              items={[
                { id: 'png', label: tb.exportPng, run: () => toolbarHost.onExport('png') },
                { id: 'svg', label: tb.exportSvg, run: () => toolbarHost.onExport('svg') },
                { id: 'pdf', label: tb.exportPdf, run: () => toolbarHost.onExport('pdf') },
                { id: 'copy', label: tb.copyPng, run: () => toolbarHost.onExport('copy') },
              ]}
            />
          </>
        )}
      </div>
      <div className="puml-viewer-body">
      {banner || chip ? (
        <div className="puml-viewer-overlays">
          {banner}
          {chip}
        </div>
      ) : null}
      <DiagramCanvas
        ref={handleRef}
        model={viewModel}
        sourceModel={model}
        layout={layout}
        layoutModel={layoutModel}
        {...(docKey !== undefined ? { docKey } : {})}
        {...(initialSidecar ? { initialOverrides: initialSidecar.overrides, initialView: initialSidecar.view } : {})}
        selectedId={selectedId}
        {...(selectedIds ? { selectedIds } : {})}
        onSelect={onSelect}
        onViewChange={handleViewChange}
        onManualPositionsChange={handleManualPositions}
        collapsedPackages={liveCollapsed}
        onCollapsedPackagesChange={handleCollapsed}
        packageCounts={packageCounts}
        skin={model.skinparams}
        display={display}
        labels={labels}
        highlightLine={highlightLine}
        {...(onRelationSelect ? { onRelationSelect } : {})}
        {...(onRename ? { onRename } : {})}
        focusKey={activeFocus !== null ? focusKey(activeFocus) : null}
        focusAnimate={focusAnimate}
        hidden={drawHidden}
        menuContext={menuContext}
        onMenuAction={handleMenuAction}
        analysis={overlay}
      />
      {analysis && overlay ? (
        <AnalysisPanel
          id={analysisPanelId}
          model={model}
          analysis={analysis}
          overlay={overlay}
          labels={labels}
          metric={heatMetric}
          includeExternal={includeExternal}
          onMetricChange={setHeatMetric}
          onIncludeExternalChange={setIncludeExternal}
          onGoTo={goToClass}
          onClose={closeAnalysis}
          onExport={exportReport}
        />
      ) : null}
      </div>
      {playing && player ? (
        <div className="presentation-bar" role="status" aria-live="polite">
          <span className="presentation-bar-title" translate="no">{views[player.index]?.title ?? ''}</span>
          <span>{fill(labels.views.slide, { n: String(player.index + 1), total: String(views.length) })}</span>
          <span className="presentation-bar-hint">{labels.views.presentHint}</span>
          <button type="button" className="puml-viewer-reset" onClick={exitPresent}>{labels.views.exitPresent}</button>
        </div>
      ) : null}
      {paletteOpen ? (
        <CommandPalette items={allPaletteItems} labels={labels.palette} onPick={pickPaletteItem} onClose={closePalette} />
      ) : null}
    </section>
  );
}
