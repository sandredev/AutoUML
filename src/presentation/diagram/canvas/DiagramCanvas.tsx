// src/presentation/diagram/canvas/DiagramCanvas.tsx — componente React del lienzo.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Category, DiagramModel, TypeNode } from '../../../domain/diagram/model';
import type { Skinparams } from '../../../domain/diagram/skinparam';
import { ContextMenu } from '../../components/ContextMenu';
import { FALLBACK_HEAT, FALLBACK_MARK_CYCLE, FALLBACK_MARK_VIOLATION, type AnalysisOverlay } from '../analysis/overlay';
import { contextMenuEntries, type MenuAction, type MenuSubject } from '../contextMenu';
import { adjacencyOf } from '../graph/adjacency';
import { filterLayout, type DrawHidden } from '../graph/filters';
import { focusOf } from '../graph/focus';
import { pathFocus, shortestPath } from '../graph/shortestPath';
import { DEFAULT_LABELS, fill, type ViewerLabels } from '../labels';
import { collapsedOwner, isPackageNode, packageNodeName } from '../layout/aggregate';
import { applySkin, skinKey } from '../style/skin';
import type { CardDisplay } from '../style/contract';
import type { LayoutResult, ViewState } from '../types';
import { diagramToSvg, type SvgCardContent } from '../svg';
import { drawDiagram, LIGHT_THEME, type Theme } from './draw';
import { collapsePackages, hitTestPackageHeader } from './collapse';
import { labelAnchor } from './edgePath';
import { hitTestEdge } from './edgeHit';
import { centerViewOn, drawMinimap, minimapToWorld, minimapTransform } from './minimap';
import { applyOverrides, EMPTY_OVERRIDES, hasOverrides, moveBy, overridesFromRecord, overridesToRecord, retainOverrides, type Overrides } from './overrides';
import { buildIndex, hitTestNode } from './spatial';
import { pickEdge, relationOrder, relatedNext, relationFlow, shortcutOf, spatialNext, stepAlong } from './keyboardNav';
import { canPaint, fitToBounds, panBy, screenToWorld, visibleWorldRect, zoomAt } from './viewport';
import {
  blendLayouts, canAnimate, changedTypes, EASE_IN_OUT, haloIntensity, layoutsDiffer, lerpView, LAYOUT_MS, REDUCED_LAYOUT_MS, snapshotOf, VIEW_MS,
  type Frame, type FrameFx, type Snapshot,
} from './tween';

export interface DiagramCanvasHandle {
  zoomIn(): void;
  zoomOut(): void;
  /**
   * Encuadra todo el diagrama. Anima la cámara por defecto; las acciones iniciadas con el teclado
   * (p. ej. Ctrl+0) deben pasar `{ animate: false }`: se repiten muchas veces y no deben hacerse esperar.
   */
  fit(opts?: { animate?: boolean }): void;
  /** Centra una clase (anima por defecto; `{ animate: false }` para atajos de teclado). */
  focusNode(id: string, opts?: { animate?: boolean }): void;
  /** Encuadra un paquete (T10). false si no está en el layout (p. ej. plegado: usar focusNode del paquete). */
  fitPackage(name: string, opts?: { animate?: boolean }): boolean;
  /**
   * Lleva la cámara a una vista guardada (T10). Con `afterLayout` espera al layout nuevo (plegados que
   * cambian) antes de moverla; el foco, si cambia, reencuadra por su cuenta.
   */
  goToView(view: ViewState, opts?: { animate?: boolean; afterLayout?: boolean }): void;
  exportPng(): Promise<Blob | null>;
  /** PNG con escala/tema/fondo configurables (T5: tema claro por defecto). */
  exportPngFull(opts?: { scale?: 1 | 2 | 4; theme?: 'app' | 'light'; transparent?: boolean }): Promise<Blob | null>;
  /** SVG vectorial del diagrama visible (tema claro), con su tamaño en px. */
  exportSvg(): { svg: string; width: number; height: number } | null;
  /** Vista y posiciones manuales actuales (para persistir el sidecar). */
  getSnapshot(): { view: ViewState; overrides: Record<string, { dx: number; dy: number }> };
  /**
   * Devuelve las tarjetas movidas a mano a la posición que calculó el layout. Con `{ fit: true }`
   * encuadra cuando llega el layout sin overrides (encuadrar enseguida usaría los límites viejos).
   */
  resetPositions(opts?: { fit?: boolean }): void;
  /** Quita la ruta resaltada (T8). true si había una (Esc la quita antes de salir del modo foco). */
  clearRoute(): boolean;
  /** true si hay alguna tarjeta movida a mano. */
  hasManualPositions(): boolean;
  /** Ejecuta una acción del menú contextual sobre `subject` sin abrir el menú (paleta, T10.2). */
  runMenuAction(action: MenuAction, subject: MenuSubject): void;
  /** El lienzo va a cambiar de tamaño por pantalla completa (#38): el reencuadre se anima en vez de saltar. */
  smoothNextResize(): void;
}

interface Props {
  model: DiagramModel;
  layout: LayoutResult;
  /**
   * Modelo para el que se calculó `layout`. Con layout progresivo (dagre y luego ELK) el layout
   * cambia dos veces para el MISMO modelo: solo cuenta como cambio de modelo cuando cambia este.
   * Si se omite se usa `layout`.
   */
  layoutModel?: DiagramModel | null;
  /**
   * Identidad estable del documento (p. ej. el proyecto o la ruta del archivo). Si el modelo cambia
   * pero el documento es el mismo (recarga), se conservan las posiciones manuales de los ids que
   * sigan existiendo y la vista no se reencuadra. Sin docKey, un modelo nuevo lo descarta todo.
   */
  docKey?: string;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onViewChange?: (v: ViewState) => void;
  /** Se llama cuando cambia si hay tarjetas movidas a mano (para habilitar "Restablecer"). */
  onManualPositionsChange?: (has: boolean) => void;
  /**
   * Modo controlado: el padre recalcula el layout con los paquetes plegados (useDiagramLayout).
   * Sin estas props se usa el plegado solo visual de collapse.ts.
   */
  collapsedPackages?: ReadonlySet<string>;
  onCollapsedPackagesChange?: (next: Set<string>) => void;
  /** Modelo original del host (modo controlado), para encontrar el paquete de una clase plegada. */
  sourceModel?: DiagramModel | null;
  /** Paquete plegado → número de entidades (modo controlado). */
  packageCounts?: ReadonlyMap<string, number>;
  /** skinparam del documento: colores encima del tema de la app. */
  skin?: Skinparams | undefined;
  /** Reglas de hide/skinparam para dibujar las tarjetas (las mismas con que se midieron). */
  display?: CardDisplay | undefined;
  labels?: ViewerLabels;
  /** Posiciones manuales iniciales del sidecar (se aplican una vez por documento). */
  initialOverrides?: Record<string, { dx: number; dy: number }>;
  /** Vista inicial del sidecar (si hay, no se encuadra al abrir). */
  initialView?: ViewState | null;
  /**
   * Línea (numeración del modelo) de una relación que se resalta como si se hubiera seleccionado su arista
   * (T7: el cursor del editor está en esa relación). Una arista elegida con el ratón tiene prioridad.
   */
  highlightLine?: number | null;
  /** Clic en una arista: línea de su relación (T7: el editor salta a ella). null al deseleccionar. */
  onRelationSelect?: (line: number | null) => void;
  /**
   * Doble clic en una tarjeta abre un campo para renombrarla (T7). Devuelve un mensaje de error
   * (el campo sigue abierto) o null si se aplicó. Sin esta prop el doble clic no renombra.
   */
  onRename?: (id: string, next: string) => string | null;
  /**
   * Modo foco (T8): clave del foco aplicado (null = diagrama completo). Al entrar se guarda la vista y se
   * encuadra el layout enfocado cuando llegue; al salir se recupera la vista guardada. Mientras dura, las
   * posiciones manuales no se aplican ni se pueden mover tarjetas (son del diagrama completo) y
   * getSnapshot() devuelve la vista guardada.
   */
  focusKey?: string | null;
  /** Si la cámara vuela al entrar/salir del foco (false cuando lo pide el teclado). */
  focusAnimate?: boolean;
  /**
   * Filtros de dibujo (T8): nodos y tipos de relación que no se dibujan. No recalculan el layout: se quitan
   * del layout ya calculado (tampoco se pueden señalar ni seleccionar).
   */
  hidden?: DrawHidden | null;
  /** Menú contextual (T8): qué puede hacer el host. Sin `onMenuAction` solo hay acciones del lienzo. */
  menuContext?: { canGoToCode: boolean; hasFilters: boolean };
  /**
   * Acciones del menú que no son del lienzo (enfocar, ocultar, filtros, copiar, ir al código). Las del lienzo
   * (ruta desde aquí, plegar/desplegar, encuadrar, quitar ruta) se resuelven aquí.
   */
  onMenuAction?: (action: MenuAction, subject: MenuSubject) => void;
  /** Capa de análisis (T9): ciclos, violaciones de capas y mapa de calor. Solo dibujo: no toca el layout. */
  analysis?: AnalysisOverlay | null;
}

type Hover = { kind: 'node'; id: string } | { kind: 'edge'; index: number } | null;
/** Renombrado en curso: tarjeta, texto escrito, error de validación y posición en pantalla al abrirlo. */
interface RenameDraft { id: string; value: string; error: string | null; x: number; y: number; w: number }
/** Arista seleccionada; el índice solo vale para el layout y los filtros con que se eligió. */
interface EdgeSelection { layout: LayoutResult; hidden: DrawHidden | null; index: number }
/** Ruta entre dos clases (T8); vale para el modelo en que se pidió. `to` null: falta elegir el destino. */
interface RouteRequest { model: DiagramModel; from: string; to: string | null; directed: boolean }
/** Menú contextual abierto: punto (ventana) y sobre qué. */
interface MenuState { x: number; y: number; subject: MenuSubject }
/** Vista pendiente hasta que llegue un layout distinto de `from`: encuadrar o ir a `target`. */
interface PendingView { from: LayoutResult; target?: ViewState; animate?: boolean }

const CATEGORIES: Category[] = ['sealed', 'abstract', 'interface', 'enum', 'record', 'annotation', 'class', 'external', 'undeclared'];
const MAX_EXPORT_SIDE = 16384;
const DRAG_THRESHOLD = 4;
const FIT_PADDING = 16;
/** Margen para que llegue el cambio de tamaño de la pantalla completa (el gestor de ventanas tarda). */
const SMOOTH_RESIZE_MS = 1000;
/** Tolerancia del hit-test de aristas, en píxeles de pantalla. */
const EDGE_TOL_PX = 6;
const TIP_OFFSET = 14;
const EMPTY_COUNTS: ReadonlyMap<string, number> = new Map();

/** Transición de layout en curso (T6). */
interface LayoutAnim {
  from: Snapshot;
  /** Tarjetas del layout anterior: las que salen ya no existen en el modelo nuevo y se dibujan con esto. */
  types: ReadonlyMap<string, TypeNode>;
  start: number;
  duration: number;
  reduce: boolean;
}
/** Vuelo de cámara en curso (T6). */
interface ViewAnim { from: ViewState; to: ViewState; start: number; duration: number }

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/** Contenido textual de las tarjetas para el export SVG (nombre + miembros). */
function svgCardsOf(model: DiagramModel): Map<string, SvgCardContent> {
  const out = new Map<string, SvgCardContent>();
  for (const t of model.types) {
    const members: string[] = [];
    for (const a of t.attributes) members.push(`${a.visibility} ${a.name}: ${a.type}${a.isStatic ? ' {static}' : ''}`);
    for (const m of t.methods) {
      const params = m.parameters.map((p) => `${p.name}: ${p.type}`).join(', ');
      const extra = m.parametersAbbreviated !== undefined ? `, …${m.parametersAbbreviated}` : '';
      members.push(`${m.visibility} ${m.name}(${params}${extra}): ${m.returnType}${m.isStatic ? ' {static}' : ''}${m.isAbstract ? ' {abstract}' : ''}`);
    }
    for (const c of t.constructors) {
      const params = c.parameters.map((p) => `${p.name}: ${p.type}`).join(', ');
      members.push(`${c.visibility} ${c.name}(${params})`);
    }
    for (const e of t.enumConstants) members.push(e);
    out.set(t.id, { name: t.name, members });
  }
  return out;
}

function readTheme(el: HTMLElement): Theme {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  const cat = {} as Record<Category, string>;
  for (const c of CATEGORIES) cat[c] = v(`--cat-${c}`, '#57606a');
  const cardBorder = v('--uml-card-border', '#181818');
  return {
    bg: v('--bg-elev', '#ffffff'),
    fg: v('--fg', '#1f2328'),
    muted: v('--fg-muted', '#656d76'),
    border: v('--border', '#d0d7de'),
    accent: v('--accent', '#0969da'),
    cat,
    card: v('--uml-card', '#F1F1F1'),
    cardBorder,
    cardFg: v('--uml-card-fg', '#000000'),
    edge: v('--uml-edge', '#181818'),
    pkg: v('--uml-pkg', '#555b62'),
    noteBg: v('--uml-note', '#FEFECE'),
    noteBorder: v('--uml-note-border', cardBorder),
    noteFg: v('--uml-note-fg', '#000000'),
    heat: [1, 2, 3, 4, 5].map((i) => v(`--heat-${i}`, FALLBACK_HEAT[i - 1] as string)),
    markCycle: v('--mark-cycle', FALLBACK_MARK_CYCLE),
    markViolation: v('--mark-violation', FALLBACK_MARK_VIOLATION),
  };
}

function sameHover(a: Hover, b: Hover): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'node' && b.kind === 'node') return a.id === b.id;
  if (a.kind === 'edge' && b.kind === 'edge') return a.index === b.index;
  return false;
}

export const DiagramCanvas = forwardRef<DiagramCanvasHandle, Props>(function DiagramCanvas(
  {
    model, layout, layoutModel, docKey, selectedId = null, onSelect, onViewChange, onManualPositionsChange,
    collapsedPackages: collapsedProp, onCollapsedPackagesChange, sourceModel, packageCounts = EMPTY_COUNTS, skin, display,
    labels = DEFAULT_LABELS, initialOverrides, initialView, highlightLine = null, onRelationSelect, onRename,
    focusKey = null, focusAnimate = true, hidden = null, menuContext, onMenuAction, analysis = null,
  },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ViewState>({ scale: 1, tx: 0, ty: 0 });
  const pendingFocusRef = useRef<string | null>(null);
  /** Plegado o foco pedido: se encuadra (o se va a `target`) cuando llegue un layout distinto de `from`. */
  const pendingFitRef = useRef<PendingView | null>(null);
  /** Layout del último commit: el que se veía al pedir el foco. */
  const committedLayoutRef = useRef<LayoutResult>(layout);
  /** Vista al entrar en el modo foco (T8). */
  const focusViewRef = useRef<{ view: ViewState; autoFit: boolean } | null>(null);
  const focusKeyRef = useRef<string | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const themeRef = useRef<Theme | null>(null);
  const rafRef = useRef(0);
  // true mientras la vista sea la del último "encuadrar": entonces un cambio de tamaño vuelve a encuadrar.
  // Se pone en false cuando el usuario hace zoom o mueve la vista.
  const autoFitRef = useRef(true);
  /** Hasta este instante, los cambios de tamaño reencuadran con vuelo (pantalla completa, #38). */
  const smoothResizeUntil = useRef(0);
  // Arrastre: 'pan' mueve la vista; con nodeId mueve una tarjeta.
  const dragRef = useRef<{ id: number; x: number; y: number; moved: boolean; nodeId: string | null } | null>(null);
  /** Arrastre en el minimapa: (dx, dy) = centro de la vista − punto agarrado, en mundo. */
  const miniDragRef = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const paintErrorRef = useRef<string | null>(null);
  // Animación (T6). Todo en refs: un fotograma no pasa por React.
  const animRef = useRef<LayoutAnim | null>(null);
  const frameRef = useRef<Frame | null>(null);
  const viewAnimRef = useRef<ViewAnim | null>(null);
  const haloRef = useRef<{ ids: ReadonlySet<string>; start: number } | null>(null);
  const shownRef = useRef<{ layout: LayoutResult; model: DiagramModel; docKey: string | undefined; modelKey: unknown } | null>(null);
  const docModelRef = useRef<{ docKey: string | undefined; model: DiagramModel } | null>(null);
  /** Los overrides iniciales del sidecar llegan después del layout: colocarlos no es una animación. */
  const skipAnimRef = useRef(false);
  const [internalCollapsed, setInternalCollapsed] = useState<Set<string>>(() => new Set());
  const [paintError, setPaintError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Overrides>(EMPTY_OVERRIDES);
  const [draggingNode, setDraggingNode] = useState(false);
  const [hover, setHover] = useState<Hover>(null);
  const [edgeSel, setEdgeSel] = useState<EdgeSelection | null>(null);
  const [rename, setRename] = useState<RenameDraft | null>(null);
  const [routeReq, setRouteReq] = useState<RouteRequest | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  /**
   * Modo relaciones (Ctrl lo activa/desactiva): null = apagado. `edge` = relación elegida con Mayús + flechas
   * (índice en las aristas visibles; null = todas) y `step` = paso del flujo padre → comentario → hija.
   */
  const [relMode, setRelMode] = useState<{ edge: number | null; step: number } | null>(null);
  const relModeRef = useRef(relMode);
  relModeRef.current = relMode;
  /** Ctrl pulsado sin otra tecla todavía (al soltarlo alterna el modo relaciones). */
  const ctrlAloneRef = useRef(false);
  /** Momento de la última apertura por teclado: el evento contextmenu que la sigue no abre otro. */
  const keyMenuAt = useRef(-Infinity);
  const inFocus = focusKey !== null;

  const controlled = collapsedProp !== undefined;
  const collapsedPackages = collapsedProp ?? internalCollapsed;

  // Cambio de modelo: mismo documento ⇒ se migran las posiciones manuales por id; si no, se descartan.
  // Se deriva durante el render (no en un efecto) para no pintar un fotograma con overrides viejos.
  const modelKey = layoutModel ?? layout;
  const [tracked, setTracked] = useState({ modelKey, docKey });
  if (tracked.modelKey !== modelKey || tracked.docKey !== docKey) {
    const sameDoc = docKey !== undefined && tracked.docKey === docKey;
    setTracked({ modelKey, docKey });
    const ids = layout.nodes.map((n) => n.id);
    // En modo foco el layout solo tiene una parte de las tarjetas: no se olvidan las demás.
    setOverrides((prev) => (sameDoc ? (inFocus ? prev : retainOverrides(prev, ids)) : EMPTY_OVERRIDES));
  }

  // Entrar/salir del modo foco o cambiar su objetivo (T8). Se deriva en el render: el layout nuevo puede
  // llegar en este mismo render (caché) y el efecto que encuadra tiene que encontrar ya la petición.
  if (focusKey !== focusKeyRef.current) {
    const entering = focusKeyRef.current === null;
    focusKeyRef.current = focusKey;
    setRouteReq(null); // la ruta era del modelo anterior: al volver de la caché reaparecería
    if (focusKey !== null && entering) focusViewRef.current = { view: { ...viewRef.current }, autoFit: autoFitRef.current };
    const saved = focusKey === null ? focusViewRef.current : null;
    if (focusKey === null) focusViewRef.current = null;
    pendingFitRef.current = saved
      ? { from: committedLayoutRef.current, target: saved.view, animate: focusAnimate }
      : { from: committedLayoutRef.current, animate: focusAnimate };
    if (saved) autoFitRef.current = saved.autoFit;
  }

  // Iniciales del sidecar: se aplican una vez por documento (aunque lleguen tarde por la
  // carga asíncrona). Ganan al vacío/retain del bloque anterior porque van después.
  const initialsFor = useRef<string | undefined>(undefined);
  const fittedFor = useRef<string | undefined>(undefined);
  if (docKey !== undefined && initialsFor.current !== docKey && (initialOverrides !== undefined || initialView !== undefined)) {
    initialsFor.current = docKey;
    if (initialOverrides !== undefined) {
      setOverrides(overridesFromRecord(initialOverrides));
      skipAnimRef.current = true;
    }
    if (initialView !== undefined && initialView !== null) {
      viewRef.current = { ...initialView };
      autoFitRef.current = false;
      fittedFor.current = docKey;
    }
  }

  const movedLayout = useMemo(() => (inFocus ? layout : applyOverrides(layout, overrides)), [inFocus, layout, overrides]);
  const visibleLayout = useMemo(
    () => filterLayout(
      controlled ? movedLayout : collapsePackages(model, movedLayout, collapsedPackages, labels.collapsedSubtitle),
      model,
      hidden,
    ),
    [controlled, model, movedLayout, collapsedPackages, labels.collapsedSubtitle, hidden],
  );
  const index = useMemo(() => buildIndex(visibleLayout), [visibleLayout]);
  const clickedEdge = edgeSel !== null && edgeSel.layout === layout && edgeSel.hidden === hidden ? edgeSel.index : null;
  // Arista de la relación en la que está el cursor del editor (T7); el clic del ratón manda.
  const lineEdge = useMemo(() => {
    if (highlightLine === null) return null;
    const i = visibleLayout.edges.findIndex((e) => e.rel !== undefined && model.relationships[e.rel]?.line === highlightLine);
    return i >= 0 ? i : null;
  }, [visibleLayout, model, highlightLine]);
  const selectedEdge = clickedEdge ?? lineEdge;
  // Ruta (T8): BFS sobre la adyacencia memoizada del modelo dibujado; manda sobre el foco de selección.
  const route = routeReq !== null && routeReq.model === model ? routeReq : null;
  const routePath = useMemo(
    () => (route?.to != null ? shortestPath(adjacencyOf(route.model), route.from, route.to, route.directed) : null),
    [route],
  );
  const routeDirected = route?.directed ?? false;
  const focus = useMemo(
    () => (routePath
      ? pathFocus(visibleLayout, routePath, routeDirected)
      : focusOf(visibleLayout, selectedEdge === null ? selectedId : null, selectedEdge)),
    [visibleLayout, selectedId, selectedEdge, routePath, routeDirected],
  );
  // Un hover de arista de otro layout ya no apunta a la misma arista.
  const liveHover: Hover = hover?.kind === 'edge' && !visibleLayout.edges[hover.index] ? null : hover;

  const degree = useMemo(() => {
    const inc = new Map<string, number>();
    const out = new Map<string, number>();
    for (const r of model.relationships) {
      out.set(r.source, (out.get(r.source) ?? 0) + 1);
      inc.set(r.target, (inc.get(r.target) ?? 0) + 1);
    }
    return { inc, out };
  }, [model]);

  // Siempre las últimas props para los callbacks estables.
  const snapshot = {
    model, sourceModel, layout: visibleLayout, sourceLayout: layout, index, selectedId, onSelect, onViewChange,
    collapsedPackages, overrides, focus, hover: liveHover, display, labels, packageCounts, onRelationSelect, onRename,
    inFocus, route, hidden, analysis,
  };
  const latest = useRef(snapshot);
  latest.current = snapshot;

  const manual = hasOverrides(overrides);
  useEffect(() => {
    onManualPositionsChange?.(manual);
  }, [manual, onManualPositionsChange]);

  // Muestra el error de dibujo en pantalla; no repite el estado si no cambia.
  const reportPaint = useCallback((msg: string | null) => {
    if (paintErrorRef.current === msg) return;
    paintErrorRef.current = msg;
    setPaintError(msg);
  }, []);

  const skinRef = useRef(skin);
  skinRef.current = skin;
  const themeOf = useCallback((el: HTMLElement): Theme => applySkin(readTheme(el), skinRef.current), []);

  const paint = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const size = sizeRef.current;
    if (!canPaint(size)) return;
    const L = latest.current;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reportPaint(L.labels.contextUnavailable);
        return;
      }
      themeRef.current ??= themeOf(wrap);
      const now = performance.now();
      let more = false;

      // Cámara: vuelo en curso (el usuario lo interrumpe con cualquier gesto: setView lo cancela).
      const va = viewAnimRef.current;
      if (va) {
        const t = (now - va.start) / va.duration;
        if (t >= 1) {
          viewRef.current = va.to;
          viewAnimRef.current = null;
          L.onViewChange?.(va.to);
        } else {
          viewRef.current = lerpView(va.from, va.to, EASE_IN_OUT(t), size.w, size.h);
          more = true;
        }
      }

      // Layout: transición entre el anterior y el actual (el índice se rehace por fotograma).
      let layout = L.layout;
      let index = L.index;
      let fx: FrameFx | undefined;
      let extraTypes: ReadonlyMap<string, TypeNode> | undefined;
      const an = animRef.current;
      if (an) {
        const frame = blendLayouts(an.from, L.layout, (now - an.start) / an.duration, { reduceMotion: an.reduce });
        if (frame.done) {
          animRef.current = null;
          frameRef.current = null;
        } else {
          frameRef.current = frame;
          layout = frame.layout;
          index = buildIndex(frame.layout);
          fx = frame.fx;
          extraTypes = an.types;
          more = true;
        }
      }

      // Halo de lo que cambió al recargar.
      let halo: ReadonlyMap<string, number> | undefined;
      const hr = haloRef.current;
      if (hr) {
        const k = haloIntensity(now - hr.start);
        if (k <= 0) haloRef.current = null;
        else {
          halo = new Map([...hr.ids].map((id) => [id, k] as const));
          more = true;
        }
      }

      const h = L.hover;
      drawDiagram(ctx, {
        model: L.model,
        layout,
        index,
        view: viewRef.current,
        viewW: size.w,
        viewH: size.h,
        dpr: window.devicePixelRatio || 1,
        selectedId: L.selectedId,
        theme: themeRef.current,
        hoverId: h?.kind === 'node' ? h.id : null,
        hoverEdge: h?.kind === 'edge' ? h.index : null,
        focus: L.focus,
        display: L.display,
        labels: L.labels,
        packageCounts: L.packageCounts,
        fx,
        extraTypes,
        halo,
        analysis: L.analysis,
      });
      const minimap = minimapRef.current;
      if (minimap) drawMinimap(minimap, layout, viewRef.current, size.w, size.h, themeRef.current);
      reportPaint(null);
      if (more && rafRef.current === 0) rafRef.current = requestAnimationFrame(paint);
    } catch (err) {
      console.error('[DiagramCanvas] Error al dibujar', err);
      reportPaint(errorText(err));
    }
  }, [reportPaint, themeOf]);

  const schedule = useCallback(() => {
    if (rafRef.current === 0) rafRef.current = requestAnimationFrame(paint);
  }, [paint]);

  const setView = useCallback(
    (v: ViewState) => {
      viewAnimRef.current = null; // cualquier gesto del usuario interrumpe el vuelo
      viewRef.current = v;
      latest.current.onViewChange?.(v);
      schedule();
    },
    [schedule],
  );

  /** Lleva la cámara a `target`: vuelo suave, o salto directo (teclado, movimiento reducido, ya está ahí). */
  const flyTo = useCallback(
    (target: ViewState, animate: boolean) => {
      const cur = viewRef.current;
      const size = sizeRef.current;
      const same = Math.abs(cur.tx - target.tx) < 0.5 && Math.abs(cur.ty - target.ty) < 0.5 && Math.abs(cur.scale / target.scale - 1) < 1e-3;
      if (!animate || same || !canPaint(size) || prefersReducedMotion()) {
        setView(target);
        return;
      }
      const va = viewAnimRef.current;
      if (va && Math.abs(va.to.tx - target.tx) < 0.5 && Math.abs(va.to.ty - target.ty) < 0.5 && Math.abs(va.to.scale / target.scale - 1) < 1e-3) return;
      viewAnimRef.current = { from: { ...cur }, to: target, start: performance.now(), duration: VIEW_MS };
      schedule();
    },
    [setView, schedule],
  );

  const fitAfterResetRef = useRef(false);
  const fit = useCallback((animate = false) => {
    const size = sizeRef.current;
    if (!canPaint(size)) return;
    // Margen pequeño: la vista completa aprovecha casi todo el lienzo (más zoom = más detalle legible).
    flyTo(fitToBounds(latest.current.layout.bounds, size.w, size.h, FIT_PADDING), animate);
    autoFitRef.current = true;
  }, [flyTo]);

  const focusNodeInView = useCallback((id: string, animate = true): boolean => {
    const b = latest.current.layout.nodes.find((n) => n.id === id);
    const { w, h } = sizeRef.current;
    if (!b || w <= 0 || h <= 0) return false;
    const scale = Math.max(viewRef.current.scale, 0.8);
    autoFitRef.current = false;
    flyTo({ scale, tx: w / 2 - (b.x + b.w / 2) * scale, ty: h / 2 - (b.y + b.h / 2) * scale }, animate);
    return true;
  }, [flyTo]);

  const zoomBy = useCallback(
    (factor: number) => {
      const { w, h } = sizeRef.current;
      autoFitRef.current = false;
      setView(zoomAt(viewRef.current, factor, w / 2, h / 2));
    },
    [setView],
  );

  /** Cambia el conjunto de paquetes plegados (controlado o interno) y pide encuadrar al terminar. */
  const updateCollapsed = useCallback(
    (fn: (prev: ReadonlySet<string>) => Set<string>) => {
      pendingFitRef.current = { from: latest.current.sourceLayout };
      if (controlled) onCollapsedPackagesChange?.(fn(latest.current.collapsedPackages));
      else setInternalCollapsed((prev) => fn(prev));
    },
    [controlled, onCollapsedPackagesChange],
  );

  const togglePackage = useCallback(
    (name: string) => {
      updateCollapsed((previous) => {
        const next = new Set(previous);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
    },
    [updateCollapsed],
  );

  const runMenuRef = useRef<((action: MenuAction, subject: MenuSubject) => void) | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomBy(1.25),
      zoomOut: () => zoomBy(1 / 1.25),
      fit: (opts) => fit(opts?.animate ?? true),
      focusNode: (id: string, opts) => {
        if (focusNodeInView(id, opts?.animate ?? true)) return;
        // En modo controlado `model` es el agregado (sin los tipos plegados): se busca en el original.
        const L = latest.current;
        const pkg = (L.sourceModel ?? L.model).types.find((node) => node.id === id)?.packageName;
        const target = pkg ? collapsedOwner(pkg, L.collapsedPackages) : null;
        if (target === null) return;
        pendingFocusRef.current = id;
        updateCollapsed((previous) => {
          const next = new Set(previous);
          next.delete(target);
          return next;
        });
      },
      fitPackage: (name: string, opts) => {
        const L = latest.current;
        const box = L.layout.packages.find((p) => p.name === name);
        const { w, h } = sizeRef.current;
        if (!box || !canPaint({ w, h })) return false;
        autoFitRef.current = false;
        flyTo(fitToBounds(box, w, h, FIT_PADDING), opts?.animate ?? true);
        return true;
      },
      goToView: (target: ViewState, opts) => {
        autoFitRef.current = false;
        if (opts?.afterLayout) {
          pendingFitRef.current = { from: latest.current.sourceLayout, target: { ...target }, animate: opts.animate ?? true };
          return;
        }
        flyTo({ ...target }, opts?.animate ?? true);
      },
      exportPng: async () => {
        const canvas = renderOffscreen(2, 'app', false);
        if (!canvas) return null;
        return new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
      },
      exportPngFull: async (opts) => {
        const canvas = renderOffscreen(opts?.scale ?? 2, opts?.theme ?? 'light', opts?.transparent ?? false);
        if (!canvas) return null;
        return new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
      },
      exportSvg: () => {
        const L = latest.current;
        const b = L.layout.bounds;
        if (b.w <= 0 || b.h <= 0) return null;
        return diagramToSvg(L.layout, { cards: svgCardsOf(L.model) });
      },
      // En modo foco se persiste la vista del diagrama completo, no la del foco.
      getSnapshot: () => ({ view: { ...(focusViewRef.current?.view ?? viewRef.current) }, overrides: overridesToRecord(latest.current.overrides) }),
      resetPositions: (opts) => {
        if (opts?.fit && hasOverrides(latest.current.overrides)) fitAfterResetRef.current = true;
        else if (opts?.fit) fit();
        setOverrides(EMPTY_OVERRIDES);
      },
      clearRoute: () => {
        if (latest.current.route === null) return false;
        setRouteReq(null);
        return true;
      },
      hasManualPositions: () => hasOverrides(latest.current.overrides),
      runMenuAction: (action, subject) => runMenuRef.current?.(action, subject),
      smoothNextResize: () => {
        smoothResizeUntil.current = performance.now() + SMOOTH_RESIZE_MS;
      },
    }),
    [zoomBy, fit, flyTo, focusNodeInView, updateCollapsed, themeOf],
  );

  /** Pinta el diagrama visible en un canvas fuera de pantalla (exportación). */
  function renderOffscreen(scale: number, theme: 'app' | 'light', transparent: boolean): HTMLCanvasElement | null {
    const wrap = wrapRef.current;
    const L = latest.current;
    const b = L.layout.bounds;
    if (!wrap || b.w <= 0 || b.h <= 0) return null;
    const pad = 32;
    const worldW = b.w + 2 * pad;
    const worldH = b.h + 2 * pad;
    const clamped = Math.min(scale, MAX_EXPORT_SIDE / worldW, MAX_EXPORT_SIDE / worldH);
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.floor(worldW * clamped));
    off.height = Math.max(1, Math.floor(worldH * clamped));
    const ctx = off.getContext('2d');
    if (!ctx) return null;
    drawDiagram(ctx, {
      model: L.model,
      layout: L.layout,
      index: L.index,
      view: { scale: clamped, tx: (pad - b.x) * clamped, ty: (pad - b.y) * clamped },
      viewW: off.width,
      viewH: off.height,
      dpr: 1,
      selectedId: null,
      theme: theme === 'light' ? LIGHT_THEME : themeOf(wrap),
      transparent,
      display: L.display,
      labels: L.labels,
      packageCounts: L.packageCounts,
    });
    return off;
  }

  // Pantalla completa (#36): el botón que la activa queda fuera del elemento a pantalla completa y se
  // queda con el foco, así que las teclas no llegan al lienzo. Al entrar, el lienzo toma el foco.
  useEffect(() => {
    let raf = 0;
    const onFullscreen = (): void => {
      smoothResizeUntil.current = performance.now() + SMOOTH_RESIZE_MS;
      // Tras el cambio el navegador aún puede mover el foco: tomarlo en el siguiente fotograma.
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const full = document.fullscreenElement;
        const canvas = canvasRef.current;
        if (!full || !canvas || !full.contains(canvas)) return;
        const active = document.activeElement;
        const typing = active instanceof HTMLElement && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
        if (!typing) canvas.focus({ preventScroll: true });
      });
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, []);

  // Tamaño del contenedor.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const apply = (): void => {
      const w = Math.max(0, Math.floor(wrap.clientWidth));
      const h = Math.max(0, Math.floor(wrap.clientHeight));
      const prev = sizeRef.current;
      const first = !canPaint(prev);
      sizeRef.current = { w, h };
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      // Si la vista no la ha tocado el usuario, se vuelve a encuadrar: el panel puede crecer después del
      // primer encuadre (paneles laterales, barra de herramientas) y el diagrama quedaba pequeño y corrido.
      const smooth = !first && performance.now() < smoothResizeUntil.current && !prefersReducedMotion();
      if (smooth && w > 0 && h > 0) {
        // Pantalla completa (#38): el diagrama conserva su centro en el marco nuevo y vuela al encuadre.
        const va = viewAnimRef.current;
        const target = fitToBounds(latest.current.layout.bounds, w, h, FIT_PADDING);
        if (va) viewAnimRef.current = { ...va, to: target };
        else {
          const v = viewRef.current;
          viewRef.current = { ...v, tx: v.tx + (w - prev.w) / 2, ty: v.ty + (h - prev.h) / 2 };
          flyTo(target, true);
        }
        autoFitRef.current = true;
      } else if ((first || autoFitRef.current) && w > 0 && h > 0) fit();
      else schedule();
      // Cambiar canvas.width borra el lienzo: pintar ya para no dejar un fotograma en blanco.
      if (!first && w > 0 && h > 0) {
        if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
        paint();
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit, flyTo, paint, schedule]);

  // Documento nuevo ⇒ encuadrar. Con docKey, recargar el mismo documento conserva la vista;
  // sin docKey cuenta cada modelo nuevo. Ni mover tarjetas ni el refinado dagre→ELK reencuadran.
  // Con vista inicial del sidecar no se encuadra (ya hay una vista guardada).
  const fitKey = docKey ?? modelKey;
  useEffect(() => {
    if (typeof fitKey === 'string' && fittedFor.current === fitKey) return;
    fit();
  }, [fitKey, fit]);

  // Plegar/desplegar ⇒ encuadrar cuando llegue el layout nuevo (controlado) o enseguida (visual),
  // y después centrar la clase pendiente de focusNode si ya está visible.
  useEffect(() => {
    const pending = pendingFitRef.current;
    committedLayoutRef.current = layout;
    if (pending && !(controlled && pending.from === layout)) {
      pendingFitRef.current = null;
      // La cámara se asienta a la vez que la transición del layout (sin vuelo si lo pidió el teclado).
      if (pending.target) flyTo(pending.target, pending.animate ?? true);
      else fit(pending.animate ?? true);
    }
    const id = pendingFocusRef.current;
    if (id && focusNodeInView(id)) pendingFocusRef.current = null;
  }, [layout, collapsedPackages, controlled, fit, flyTo, focusNodeInView]);

  // resetPositions({ fit: true }): encuadra con los límites del layout ya sin overrides.
  useEffect(() => {
    if (!fitAfterResetRef.current) return;
    fitAfterResetRef.current = false;
    fit(true);
  }, [visibleLayout, fit]);

  // El modo relaciones guarda un índice de arista de visibleLayout: si cambia el layout de origen,
  // los filtros o los plegados, ese índice ya no apunta a la misma relación (como edgeSel).
  useEffect(() => {
    setRelMode((rm) => (rm !== null && rm.edge !== null ? { edge: null, step: 0 } : rm));
  }, [layout, hidden, collapsedPackages]);

  // Transición de layout (T6): cuando lo que se muestra cambia de geometría dentro del MISMO documento
  // (recarga, plegar/desplegar, Restablecer, refinado dagre→ELK) las tarjetas se desplazan, entran y salen
  // en vez de saltar. No anima: el primer layout de un documento, un documento nuevo, los overrides
  // iniciales del sidecar ni el arrastre de una tarjeta (manipulación directa). Va en un efecto de layout
  // para que el primer fotograma ya parta del estado anterior, no del final.
  useLayoutEffect(() => {
    const prev = shownRef.current;
    shownRef.current = { layout: visibleLayout, model, docKey, modelKey };
    if (!prev || prev.layout === visibleLayout) return;
    const skip = skipAnimRef.current;
    skipAnimRef.current = false;
    const sameDoc = docKey !== undefined ? prev.docKey === docKey : prev.modelKey === modelKey;
    if (skip || !sameDoc || dragRef.current?.nodeId != null) {
      animRef.current = null;
      frameRef.current = null;
      return;
    }
    // Si ya había una transición a medias, la nueva parte de lo que se ve ahora (se puede interrumpir).
    const running = animRef.current !== null && frameRef.current !== null;
    const from: Snapshot = running && frameRef.current ? snapshotOf(frameRef.current) : { layout: prev.layout };
    if (!layoutsDiffer(from.layout, visibleLayout) || !canAnimate(from.layout, visibleLayout)) {
      animRef.current = null;
      frameRef.current = null;
      return;
    }
    const types = new Map<string, TypeNode>(animRef.current?.types ?? []);
    for (const t of prev.model.types) types.set(t.id, t);
    const reduce = prefersReducedMotion();
    animRef.current = { from, types, start: performance.now(), duration: reduce ? REDUCED_LAYOUT_MS : LAYOUT_MS, reduce };
    schedule();
  }, [visibleLayout, model, docKey, modelKey, schedule]);

  // Halo (T6): al recargar el mismo documento se resaltan unos segundos las tarjetas nuevas o cuyo
  // contenido cambió. Se compara el modelo ORIGINAL del layout mostrado: plegar un paquete no lo cambia.
  useEffect(() => {
    if (!layoutModel) return;
    const prev = docModelRef.current;
    docModelRef.current = { docKey, model: layoutModel };
    if (!prev || prev.model === layoutModel || docKey === undefined || prev.docKey !== docKey) return;
    const { added, modified } = changedTypes(prev.model, layoutModel);
    if (added.size + modified.size === 0) return;
    haloRef.current = { ids: new Set([...added, ...modified]), start: performance.now() };
    schedule();
  }, [layoutModel, docKey, schedule]);

  // Cualquier cambio de lo que se dibuja ⇒ repintar.
  useEffect(() => {
    schedule();
  }, [visibleLayout, selectedId, model, focus, liveHover, display, labels, packageCounts, analysis, schedule]);

  // skinparam distinto ⇒ el tema cacheado ya no vale (antes solo se invalidaba con el tema de la app).
  const skinK = skinKey(skin);
  useEffect(() => {
    themeRef.current = null;
    schedule();
  }, [skinK, schedule]);

  // Tema claro/oscuro: el del sistema Y el elegido en la app (atributo data-theme en <html>).
  useEffect(() => {
    const onChange = (): void => {
      themeRef.current = null;
      schedule();
    };
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', onChange);
    const mo = new MutationObserver(onChange);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    return () => {
      mq.removeEventListener('change', onChange);
      mo.disconnect();
    };
  }, [schedule]);

  useEffect(
    () => () => {
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
      // Libera el marcador: con StrictMode el efecto se desmonta y se vuelve a montar,
      // y un rafRef distinto de 0 bloquea schedule() y nada vuelve a pintarse.
      rafRef.current = 0;
    },
    [],
  );

  // Modo visual: olvida los paquetes plegados que ya no existen. (En modo controlado lo hace el padre.)
  useEffect(() => {
    if (controlled) return;
    const known = new Set(model.packages.map((pkg) => pkg.name));
    setInternalCollapsed((previous) => {
      const next = new Set([...previous].filter((name) => known.has(name)));
      return next.size === previous.size ? previous : next;
    });
  }, [model, controlled]);

  // Rueda: listener nativo no pasivo para poder hacer preventDefault.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      if (e.ctrlKey) ctrlAloneRef.current = false; // Ctrl+rueda es zoom: al soltar Ctrl no alterna el modo relaciones
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      autoFitRef.current = false;
      setView(zoomAt(viewRef.current, factor, e.clientX - rect.left, e.clientY - rect.top));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [setView]);

  /** Qué hay bajo el punto de pantalla (sx, sy): tarjeta primero, luego arista. */
  const pick = (sx: number, sy: number): Hover => {
    const L = latest.current;
    const p = screenToWorld(viewRef.current, sx, sy);
    const nodeId = hitTestNode(L.index, L.layout, p.x, p.y);
    if (nodeId !== null) return { kind: 'node', id: nodeId };
    const tol = EDGE_TOL_PX / (viewRef.current.scale || 1);
    const edge = hitTestEdge(L.layout, p.x, p.y, tol, L.index);
    return edge !== null ? { kind: 'edge', index: edge } : null;
  };

  /** Coloca el tooltip junto al puntero sin salirse del lienzo (sin re-render: estilo directo). */
  const placeTip = (sx: number, sy: number): void => {
    const tip = tipRef.current;
    if (!tip) return;
    const { w, h } = sizeRef.current;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const x = sx + TIP_OFFSET + tw > w ? Math.max(0, sx - TIP_OFFSET - tw) : sx + TIP_OFFSET;
    const y = sy + TIP_OFFSET + th > h ? Math.max(0, sy - TIP_OFFSET - th) : sy + TIP_OFFSET;
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };

  const updateHover = (sx: number, sy: number): void => {
    const next = pick(sx, sy);
    if (!sameHover(next, latest.current.hover)) setHover(next);
    placeTip(sx, sy);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    ctrlAloneRef.current = false; // Ctrl+clic no alterna el modo relaciones
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Sobre una tarjeta (no un paquete plegado) se arrastra la tarjeta.
    const rect = e.currentTarget.getBoundingClientRect();
    const p = screenToWorld(viewRef.current, e.clientX - rect.left, e.clientY - rect.top);
    const L = latest.current;
    const hit = hitTestNode(L.index, L.layout, p.x, p.y);
    // En modo foco no se mueven tarjetas: las posiciones manuales son del diagrama completo.
    const nodeId = hit !== null && !isPackageNode(hit) && !L.inFocus ? hit : null;
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, nodeId };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) {
      if (e.pointerType !== 'touch') updateHover(e.clientX - rect.left, e.clientY - rect.top);
      return;
    }
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      if (d.nodeId !== null) {
        setDraggingNode(true);
        // Manipulación directa: la tarjeta sigue al puntero, sin transición.
        animRef.current = null;
        frameRef.current = null;
      }
      if (latest.current.hover !== null) setHover(null);
    }
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.nodeId !== null) {
      const s = viewRef.current.scale || 1;
      const id = d.nodeId;
      setOverrides((prev) => moveBy(prev, id, dx / s, dy / s));
      return;
    }
    autoFitRef.current = false;
    setView(panBy(viewRef.current, dx, dy));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    setDraggingNode(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.moved) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const p = screenToWorld(viewRef.current, sx, sy);
    const L = latest.current;
    // Mayús+clic en otra clase con una seleccionada, o clic tras "Ruta desde aquí": ruta más corta (T8).
    // Un Mayús+clic que arrastra no llega aquí.
    const pendingFrom = L.route !== null && L.route.to === null ? L.route.from : null;
    if (pendingFrom !== null || (e.shiftKey && L.selectedId !== null)) {
      const target = pick(sx, sy);
      const from = pendingFrom ?? L.selectedId;
      if (from !== null && target?.kind === 'node' && target.id !== from && L.model.types.some((t) => t.id === from)) {
        setRouteReq((prev) => ({ model: L.model, from, to: target.id, directed: prev?.directed ?? false }));
        return;
      }
    }
    // Cualquier otro clic (fondo, tarjeta, arista, paquete) quita la ruta.
    if (L.route !== null) setRouteReq(null);
    const packageName = hitTestPackageHeader(L.layout, p.x, p.y);
    if (packageName) {
      togglePackage(packageName);
      return;
    }
    const hit = pick(sx, sy);
    if (hit?.kind === 'node' && isPackageNode(hit.id)) {
      togglePackage(packageNodeName(hit.id));
      return;
    }
    if (hit?.kind === 'edge') {
      // Arista: se resalta con sus dos clases; la selección de clase del host se limpia.
      setEdgeSel({ layout: L.sourceLayout, hidden: L.hidden, index: hit.index });
      L.onSelect?.(null);
      const rel = L.layout.edges[hit.index]?.rel;
      L.onRelationSelect?.(rel !== undefined ? (L.model.relationships[rel]?.line ?? null) : null);
      return;
    }
    if (edgeSel !== null) L.onRelationSelect?.(null);
    setEdgeSel(null);
    L.onSelect?.(hit?.kind === 'node' ? hit.id : null);
  };

  /** Objetivo del menú para lo que hay bajo un punto (o el fondo). */
  const subjectOf = (hit: Hover): MenuSubject => {
    const L = latest.current;
    if (hit?.kind === 'node') {
      if (isPackageNode(hit.id)) return { kind: 'package', id: hit.id, name: packageNodeName(hit.id) };
      const t = L.model.types.find((x) => x.id === hit.id);
      return { kind: 'node', id: hit.id, name: t?.name ?? hit.id, packageName: t?.packageName ?? '' };
    }
    if (hit?.kind === 'edge') {
      const e = L.layout.edges[hit.index];
      if (e) {
        const rel = e.rel !== undefined ? L.model.relationships[e.rel] : undefined;
        return { kind: 'edge', name: `${nameOfRef.current(e.source)} → ${nameOfRef.current(e.target)}`, relType: e.type, line: rel?.line ?? null };
      }
    }
    return { kind: 'background' };
  };

  const openMenu = (x: number, y: number, subject: MenuSubject): void => {
    setHover(null);
    // Abrir el menú sobre una clase la selecciona (como en cualquier explorador).
    if (subject.kind === 'node' && latest.current.selectedId !== subject.id) latest.current.onSelect?.(subject.id);
    setMenu({ x, y, subject });
  };

  const onContextMenu = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    e.preventDefault();
    if (e.timeStamp - keyMenuAt.current < 500) return; // ya lo abrió el teclado
    const rect = e.currentTarget.getBoundingClientRect();
    openMenu(e.clientX, e.clientY, subjectOf(pick(e.clientX - rect.left, e.clientY - rect.top)));
  };

  /** Sale del modo relaciones y quita el resaltado de la relación elegida. */
  const exitRelMode = (): void => {
    if (relModeRef.current?.edge != null) {
      setEdgeSel(null);
      latest.current.onRelationSelect?.(null);
    }
    setRelMode(null);
  };

  const onCanvasKeyUp = (e: ReactKeyboardEvent<HTMLCanvasElement>): void => {
    if (e.key !== 'Control' || !ctrlAloneRef.current) return;
    ctrlAloneRef.current = false;
    if (relModeRef.current !== null) exitRelMode();
    else setRelMode({ edge: null, step: 0 });
  };

  /** Teclado en el lienzo: tecla Menú o Mayús+F10 abren el menú de la clase seleccionada (o del fondo). */
  const onCanvasKey = (e: ReactKeyboardEvent<HTMLCanvasElement>): void => {
    if ((e.key === 'Escape' || e.key === 'Backspace') && helpOpen) {
      e.preventDefault();
      setHelpOpen(false);
      return;
    }
    // Ctrl solo (pulsar y soltar sin otra tecla) alterna el modo relaciones: Ctrl+K, Ctrl+Shift+L... no.
    if (e.key === 'Control') {
      if (!e.repeat) ctrlAloneRef.current = true;
      return;
    }
    ctrlAloneRef.current = false;
    if ((e.key === 'Backspace' || e.key === 'Escape') && relModeRef.current !== null) {
      e.preventDefault();
      exitRelMode();
      return;
    }
    const action = shortcutOf(e.key, { ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey });
    if (action !== null) {
      e.preventDefault();
      if (action === 'zoomIn') zoomBy(1.25);
      else if (action === 'zoomOut') zoomBy(1 / 1.25);
      else if (action === 'fit') fit(true);
      else if (action === 'help') setHelpOpen((open) => !open);
      else {
        // Flechas: clase más cercana en esa dirección. En modo relaciones (Ctrl): Mayús + flechas elige la
        // relación de la clase (queda resaltada) y las flechas recorren su flujo padre → comentario → hija;
        // sin relación elegida, solo por vecinas. Entre las visibles (en modo foco, el subgrafo enfocado).
        const L = latest.current;
        const rm = relModeRef.current;
        const edges = L.layout.edges;
        const flow = rm?.edge != null && edges[rm.edge] ? relationFlow(edges[rm.edge]) : null;
        if (rm !== null && e.shiftKey) {
          // Clase de partida: la del paso actual o, sobre el comentario, la anterior del flujo.
          const here = flow?.[rm.step];
          const before = flow?.[rm.step - 1];
          const anchor = here?.kind === 'node' ? here.id : before?.kind === 'node' ? before.id : L.selectedId;
          if (anchor === null) return;
          const edge = pickEdge(relationOrder(edges, L.layout.nodes, anchor), flow === null ? null : rm.edge, action);
          if (edge === null) return;
          const steps = relationFlow(edges[edge]);
          const step = steps.findIndex((st) => st.kind === 'node' && st.id === anchor);
          setRelMode({ edge, step: Math.max(0, step) });
          setEdgeSel({ layout: L.sourceLayout, hidden: L.hidden, index: edge });
          const rel = edges[edge].rel;
          L.onRelationSelect?.(rel !== undefined ? (L.model.relationships[rel]?.line ?? null) : null);
          if (anchor !== L.selectedId) L.onSelect?.(anchor);
          return;
        }
        if (rm !== null && flow !== null && rm.edge !== null) {
          const step = stepAlong(flow.length, rm.step, action);
          if (step === rm.step) return;
          setRelMode({ edge: rm.edge, step });
          const st = flow[step];
          if (st.kind === 'node') {
            L.onSelect?.(st.id);
            focusNodeInView(st.id, true);
          } else {
            const pts = edges[rm.edge].points;
            const at = labelAnchor(pts);
            const { w, h } = sizeRef.current;
            if (at && w > 0 && h > 0) {
              const scale = Math.max(viewRef.current.scale, 0.8);
              autoFitRef.current = false;
              flyTo({ scale, tx: w / 2 - at.x * scale, ty: h / 2 - at.y * scale }, true);
            }
          }
          return;
        }
        const next = rm !== null
          ? relatedNext(L.layout.nodes, L.model.relationships, L.selectedId, null, action)
          : spatialNext(L.layout.nodes, L.selectedId, action);
        if (next !== null && next !== L.selectedId) {
          L.onSelect?.(next);
          focusNodeInView(next, true);
        }
      }
      return;
    }
    if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return;
    e.preventDefault();
    keyMenuAt.current = e.timeStamp;
    const L = latest.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const v = viewRef.current;
    const b = L.selectedId !== null ? L.layout.nodes.find((n) => n.id === L.selectedId) : undefined;
    if (b) {
      const x = rect.left + (b.x + b.w / 2) * v.scale + v.tx;
      const y = rect.top + (b.y + b.h / 2) * v.scale + v.ty;
      openMenu(Math.min(Math.max(x, rect.left), rect.right), Math.min(Math.max(y, rect.top), rect.bottom), subjectOf({ kind: 'node', id: b.id }));
    } else openMenu(rect.left + rect.width / 2, rect.top + rect.height / 2, { kind: 'background' });
  };

  const runMenu = (action: MenuAction, subject: MenuSubject): void => {
    setMenu(null);
    const L = latest.current;
    switch (action) {
      case 'route-from':
        if (subject.kind === 'node' || subject.kind === 'package') {
          const from = subject.id;
          setRouteReq((prev) => ({ model: L.model, from, to: null, directed: prev?.directed ?? false }));
        }
        return;
      case 'collapse-package':
        if (subject.kind === 'node' && subject.packageName) {
          const name = subject.packageName;
          updateCollapsed((prev) => new Set([...prev, name]));
        }
        return;
      case 'expand-package':
        if (subject.kind === 'package') togglePackage(subject.name);
        return;
      case 'fit':
        fit(true);
        return;
      case 'clear-route':
        setRouteReq(null);
        return;
      default:
        onMenuAction?.(action, subject);
    }
  };

  runMenuRef.current = runMenu;

  const onPointerLeave = (): void => {
    if (!dragRef.current && latest.current.hover !== null) setHover(null);
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = screenToWorld(viewRef.current, e.clientX - rect.left, e.clientY - rect.top);
    const L = latest.current;
    const nodeId = hitTestNode(L.index, L.layout, p.x, p.y);
    if (nodeId === null && !hitTestPackageHeader(L.layout, p.x, p.y)) {
      fit(true);
      return;
    }
    // Doble clic en una tarjeta (no en un paquete plegado): renombrar en línea, encima de su cabecera.
    const box = nodeId !== null && !isPackageNode(nodeId) ? L.layout.nodes.find((n) => n.id === nodeId) : undefined;
    if (!box || !L.onRename) return;
    const v = viewRef.current;
    const name = L.model.types.find((t) => t.id === box.id)?.name ?? box.id;
    setHover(null);
    setRename({ id: box.id, value: name, error: null, x: box.x * v.scale + v.tx, y: box.y * v.scale + v.ty, w: box.w * v.scale });
  };

  const commitRename = (): void => {
    const r = rename;
    const apply = latest.current.onRename;
    if (!r || !apply) return;
    const error = apply(r.id, r.value.trim());
    if (error === null) setRename(null);
    else setRename({ ...r, error });
  };

  // ---------- Minimapa: clic para centrar, arrastrar el recuadro para desplazar ----------
  const miniWorld = (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const el = e.currentTarget;
    const t = minimapTransform(latest.current.layout.bounds, el.clientWidth, el.clientHeight);
    if (!t) return null;
    const rect = el.getBoundingClientRect();
    return minimapToWorld(t, e.clientX - rect.left, e.clientY - rect.top);
  };

  const onMiniDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return;
    const w = miniWorld(e);
    if (!w) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const { w: vw, h: vh } = sizeRef.current;
    const vis = visibleWorldRect(viewRef.current, vw, vh);
    const inside = w.x >= vis.x && w.x <= vis.x + vis.w && w.y >= vis.y && w.y <= vis.y + vis.h;
    // Dentro del recuadro se agarra donde se pulsó; fuera, se centra la vista en el punto.
    const dx = inside ? vis.x + vis.w / 2 - w.x : 0;
    const dy = inside ? vis.y + vis.h / 2 - w.y : 0;
    miniDragRef.current = { id: e.pointerId, dx, dy };
    autoFitRef.current = false;
    if (!inside) setView(centerViewOn(viewRef.current, w.x, w.y, vw, vh));
  };

  const onMiniMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const d = miniDragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const w = miniWorld(e);
    if (!w) return;
    const { w: vw, h: vh } = sizeRef.current;
    setView(centerViewOn(viewRef.current, w.x + d.dx, w.y + d.dy, vw, vh));
  };

  const onMiniUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (miniDragRef.current?.id !== e.pointerId) return;
    miniDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  /** Teclado en el minimapa: flechas desplazan un 10 % de la vista (alternativa al arrastre). */
  const onMiniKey = (e: ReactKeyboardEvent<HTMLCanvasElement>): void => {
    const step: Record<string, [number, number]> = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const dir = step[e.key];
    if (!dir) return;
    e.preventDefault();
    const { w, h } = sizeRef.current;
    autoFitRef.current = false;
    setView(panBy(viewRef.current, dir[0] * w * 0.1, dir[1] * h * 0.1));
  };

  // ---------- Tooltip ----------
  const typeById = useMemo(() => new Map(model.types.map((t) => [t.id, t] as const)), [model]);
  const nameOf = (id: string): string => typeById.get(id)?.name ?? (isPackageNode(id) ? packageNodeName(id) : id);
  const nameOfRef = useRef(nameOf);
  nameOfRef.current = nameOf;
  let tip: JSX.Element | null = null;
  if (liveHover?.kind === 'node') {
    const id = liveHover.id;
    const relations = fill(labels.tipRelations, { in: degree.inc.get(id) ?? 0, out: degree.out.get(id) ?? 0 });
    if (isPackageNode(id)) {
      const name = packageNodeName(id);
      tip = (
        <>
          <strong>{name}</strong>
          <span>{fill(labels.tipEntities, { n: packageCounts.get(name) ?? 0 })}</span>
          <span>{relations}</span>
        </>
      );
    } else {
      const t = typeById.get(id);
      if (t) {
        tip = (
          <>
            <strong>{t.name}</strong>
            <span>{labels.tipPackage}: {t.packageName && t.packageName !== '(default package)' ? t.packageName : labels.noPackage}</span>
            <span>{labels.tipKind}: {labels.categories[t.category]}</span>
            <span>{relations}</span>
          </>
        );
      }
    }
  } else if (liveHover?.kind === 'edge') {
    const e = visibleLayout.edges[liveHover.index];
    const r = e?.rel !== undefined ? model.relationships[e.rel] : undefined;
    if (e) {
      const mult = r?.sourceLabel || r?.targetLabel ? `${r.sourceLabel ?? '—'} → ${r.targetLabel ?? '—'}` : null;
      const label = r?.label ?? e.label;
      tip = (
        <>
          <strong>{labels.relTypes[e.type]}</strong>
          <span>{nameOf(e.source)} → {nameOf(e.target)}</span>
          {mult !== null ? <span>{labels.tipMultiplicity}: {mult}</span> : null}
          {label ? <span>{labels.tipLabel}: {label}</span> : null}
        </>
      );
    }
  }

  const cursor = liveHover !== null && !draggingNode ? ' is-hovering' : '';
  return (
    <div ref={wrapRef} className={(draggingNode ? 'diagram-canvas is-dragging-node' : 'diagram-canvas') + cursor}>
      <canvas
        ref={canvasRef}
        aria-label={labels.canvasAria}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onKeyDown={onCanvasKey}
        onKeyUp={onCanvasKeyUp}
        onBlur={() => { ctrlAloneRef.current = false; }}
        tabIndex={0}
        aria-keyshortcuts="F Enter Escape Backspace Shift+F10 ArrowLeft ArrowRight ArrowUp ArrowDown Control Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown + - 0 ?"
      />
      <canvas
        ref={minimapRef}
        className="diagram-minimap"
        aria-label={labels.minimapAria}
        tabIndex={0}
        onKeyDown={onMiniKey}
        onPointerDown={onMiniDown}
        onPointerMove={onMiniMove}
        onPointerUp={onMiniUp}
        onPointerCancel={onMiniUp}
      />
      {relMode !== null ? (
        <div className="puml-viewer-relmode" role="status" style={{ position: 'absolute', left: 8, bottom: 8, padding: '2px 8px', borderRadius: 4, background: 'rgba(0,0,0,.65)', color: '#fff', font: '12px sans-serif', pointerEvents: 'none' }}>
          {labels.relMode}
          {relMode.edge !== null && visibleLayout.edges[relMode.edge]
            ? relationFlow(visibleLayout.edges[relMode.edge]).map((st, i) => (
                <span key={i} style={{ fontWeight: i === relMode.step ? 700 : 400, opacity: i === relMode.step ? 1 : 0.7 }}>
                  {i === 0 ? ': ' : ' → '}{st.kind === 'node' ? st.id : `«${st.text}»`}
                </span>
              ))
            : `: ${labels.relModeAll}`}
        </div>
      ) : null}
      {helpOpen ? (
        <div className="diagram-shortcuts" role="dialog" aria-label={labels.shortcutsTitle}>
          <h2>{labels.shortcutsTitle}</h2>
          <dl>
            <dt><kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd></dt>
            <dd>{labels.shortcutsNav}</dd>
            <dt><kbd>Ctrl</kbd></dt>
            <dd>{labels.shortcutsNavLinked}</dd>
            <dt><kbd>Shift</kbd> + <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd></dt>
            <dd>{labels.shortcutsNavRelation}</dd>
            <dt><kbd>F</kbd> / <kbd>Enter</kbd></dt>
            <dd>{labels.shortcutsFocus}</dd>
            <dt><kbd>Esc</kbd> / <kbd>⌫</kbd></dt>
            <dd>{labels.shortcutsEscape}</dd>
            <dt><kbd>+</kbd> <kbd>−</kbd></dt>
            <dd>{labels.shortcutsZoom}</dd>
            <dt><kbd>0</kbd></dt>
            <dd>{labels.shortcutsFit}</dd>
            <dt><kbd>?</kbd></dt>
            <dd>{labels.shortcutsHelp}</dd>
          </dl>
          <button type="button" className="diagram-route-clear" onClick={() => setHelpOpen(false)}>{labels.shortcutsClose}</button>
        </div>
      ) : null}
      <div ref={tipRef} className="diagram-tooltip" role="tooltip" hidden={tip === null || rename !== null}>
        {tip}
      </div>
      {rename !== null ? (
        <div
          className="diagram-rename"
          style={{ transform: `translate(${Math.round(rename.x)}px, ${Math.round(rename.y)}px)`, width: Math.max(160, Math.round(rename.w)) }}
        >
          <input
            autoFocus
            spellCheck={false}
            aria-label={labels.renameAria}
            aria-invalid={rename.error !== null}
            value={rename.value}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setRename({ ...rename, value: e.target.value, error: null })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setRename(null);
              }
            }}
            onBlur={() => setRename(null)}
          />
          {rename.error !== null ? <p role="alert">{rename.error}</p> : null}
        </div>
      ) : null}
      {route !== null ? (
        <div className="diagram-route" role="group" aria-label={labels.routeAria}>
          <span role="status" className={routePath || route.to === null ? 'diagram-route-info' : 'diagram-route-info is-empty'}>
            {route.to === null
              ? fill(labels.routePick, { from: nameOf(route.from) })
              : fill(routePath ? labels.routeInfo : labels.routeNone, {
                from: nameOf(route.from),
                to: nameOf(route.to),
                n: (routePath?.length ?? 1) - 1,
              })}
          </span>
          <label className="diagram-route-directed">
            <input type="checkbox" checked={route.directed} onChange={(e) => setRouteReq({ ...route, directed: e.target.checked })} />
            {labels.routeDirected}
          </label>
          <button type="button" className="diagram-route-clear" onClick={() => setRouteReq(null)}>
            {labels.routeClear}
          </button>
        </div>
      ) : null}
      {menu !== null ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={labels.menuAria}
          items={contextMenuEntries(
            menu.subject,
            {
              canGoToCode: menuContext?.canGoToCode ?? false,
              hasFilters: menuContext?.hasFilters ?? false,
              hasRoute: route !== null,
              inFocus,
            },
            labels,
          ).map((it) => ({ id: it.action, label: it.label, ...(it.disabled ? { disabled: true } : {}), ...(it.shortcut ? { shortcut: it.shortcut } : {}) }))}
          onSelect={(id) => runMenu(id as MenuAction, menu.subject)}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {paintError !== null ? (
        <p
          className="render-meta diagram-paint-error"
          role="alert"
          style={{ position: 'absolute', top: 8, left: 8, right: 8, margin: 0, padding: '6px 10px', background: 'var(--bg-elev, #fff)', border: '1px solid var(--border, #d0d7de)', color: 'var(--danger, #cf222e)' }}
        >
          {labels.paintError + paintError}
        </p>
      ) : null}
    </div>
  );
});
