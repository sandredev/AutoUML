// src/presentation/diagram/canvas/DiagramCanvas.tsx — componente React del lienzo.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Category, DiagramModel } from '../../../domain/diagram/model';
import type { Skinparams } from '../../../domain/diagram/skinparam';
import { focusOf } from '../graph/focus';
import { DEFAULT_LABELS, fill, type ViewerLabels } from '../labels';
import { collapsedOwner, isPackageNode, packageNodeName } from '../layout/aggregate';
import { applySkin, skinKey } from '../style/skin';
import type { CardDisplay } from '../style/contract';
import type { LayoutResult, ViewState } from '../types';
import { diagramToSvg, type SvgCardContent } from '../svg';
import { drawDiagram, LIGHT_THEME, type Theme } from './draw';
import { collapsePackages, hitTestPackageHeader } from './collapse';
import { hitTestEdge } from './edgeHit';
import { centerViewOn, drawMinimap, minimapToWorld, minimapTransform } from './minimap';
import { applyOverrides, EMPTY_OVERRIDES, hasOverrides, moveBy, overridesFromRecord, overridesToRecord, retainOverrides, type Overrides } from './overrides';
import { buildIndex, hitTestNode } from './spatial';
import { canPaint, fitToBounds, panBy, screenToWorld, visibleWorldRect, zoomAt } from './viewport';

export interface DiagramCanvasHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  focusNode(id: string): void;
  exportPng(): Promise<Blob | null>;
  /** PNG con escala/tema/fondo configurables (T5: tema claro por defecto). */
  exportPngFull(opts?: { scale?: 1 | 2 | 4; theme?: 'app' | 'light'; transparent?: boolean }): Promise<Blob | null>;
  /** SVG vectorial del diagrama visible (tema claro), con su tamaño en px. */
  exportSvg(): { svg: string; width: number; height: number } | null;
  /** Vista y posiciones manuales actuales (para persistir el sidecar). */
  getSnapshot(): { view: ViewState; overrides: Record<string, { dx: number; dy: number }> };
  /** Devuelve las tarjetas movidas a mano a la posición que calculó el layout. */
  resetPositions(): void;
  /** true si hay alguna tarjeta movida a mano. */
  hasManualPositions(): boolean;
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
}

type Hover = { kind: 'node'; id: string } | { kind: 'edge'; index: number } | null;
/** Arista seleccionada; el índice solo vale para el layout en que se eligió. */
interface EdgeSelection { layout: LayoutResult; index: number }

const CATEGORIES: Category[] = ['sealed', 'abstract', 'interface', 'enum', 'record', 'annotation', 'class', 'external', 'undeclared'];
const MAX_EXPORT_SIDE = 16384;
const DRAG_THRESHOLD = 4;
const FIT_PADDING = 16;
/** Tolerancia del hit-test de aristas, en píxeles de pantalla. */
const EDGE_TOL_PX = 6;
const TIP_OFFSET = 14;
const EMPTY_COUNTS: ReadonlyMap<string, number> = new Map();

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
    labels = DEFAULT_LABELS, initialOverrides, initialView,
  },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ViewState>({ scale: 1, tx: 0, ty: 0 });
  const pendingFocusRef = useRef<string | null>(null);
  /** Plegado pedido: se encuadra cuando llegue un layout distinto de `from` (o enseguida sin control). */
  const pendingFitRef = useRef<{ from: LayoutResult } | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const themeRef = useRef<Theme | null>(null);
  const rafRef = useRef(0);
  // true mientras la vista sea la del último "encuadrar": entonces un cambio de tamaño vuelve a encuadrar.
  // Se pone en false cuando el usuario hace zoom o mueve la vista.
  const autoFitRef = useRef(true);
  // Arrastre: 'pan' mueve la vista; con nodeId mueve una tarjeta.
  const dragRef = useRef<{ id: number; x: number; y: number; moved: boolean; nodeId: string | null } | null>(null);
  /** Arrastre en el minimapa: (dx, dy) = centro de la vista − punto agarrado, en mundo. */
  const miniDragRef = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const paintErrorRef = useRef<string | null>(null);
  const [internalCollapsed, setInternalCollapsed] = useState<Set<string>>(() => new Set());
  const [paintError, setPaintError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Overrides>(EMPTY_OVERRIDES);
  const [draggingNode, setDraggingNode] = useState(false);
  const [hover, setHover] = useState<Hover>(null);
  const [edgeSel, setEdgeSel] = useState<EdgeSelection | null>(null);

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
    setOverrides((prev) => (sameDoc ? retainOverrides(prev, ids) : EMPTY_OVERRIDES));
  }

  // Iniciales del sidecar: se aplican una vez por documento (aunque lleguen tarde por la
  // carga asíncrona). Ganan al vacío/retain del bloque anterior porque van después.
  const initialsFor = useRef<string | undefined>(undefined);
  const fittedFor = useRef<string | undefined>(undefined);
  if (docKey !== undefined && initialsFor.current !== docKey && (initialOverrides !== undefined || initialView !== undefined)) {
    initialsFor.current = docKey;
    if (initialOverrides !== undefined) setOverrides(overridesFromRecord(initialOverrides));
    if (initialView !== undefined && initialView !== null) {
      viewRef.current = { ...initialView };
      autoFitRef.current = false;
      fittedFor.current = docKey;
    }
  }

  const movedLayout = useMemo(() => applyOverrides(layout, overrides), [layout, overrides]);
  const visibleLayout = useMemo(
    () => (controlled ? movedLayout : collapsePackages(model, movedLayout, collapsedPackages, labels.collapsedSubtitle)),
    [controlled, model, movedLayout, collapsedPackages, labels.collapsedSubtitle],
  );
  const index = useMemo(() => buildIndex(visibleLayout), [visibleLayout]);
  const selectedEdge = edgeSel !== null && edgeSel.layout === layout ? edgeSel.index : null;
  const focus = useMemo(
    () => focusOf(visibleLayout, selectedEdge === null ? selectedId : null, selectedEdge),
    [visibleLayout, selectedId, selectedEdge],
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
    collapsedPackages, overrides, focus, hover: liveHover, display, labels, packageCounts,
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
      const h = L.hover;
      drawDiagram(ctx, {
        model: L.model,
        layout: L.layout,
        index: L.index,
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
      });
      const minimap = minimapRef.current;
      if (minimap) drawMinimap(minimap, L.layout, viewRef.current, size.w, size.h, themeRef.current);
      reportPaint(null);
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
      viewRef.current = v;
      latest.current.onViewChange?.(v);
      schedule();
    },
    [schedule],
  );

  const fit = useCallback(() => {
    const size = sizeRef.current;
    if (!canPaint(size)) return;
    // Margen pequeño: la vista completa aprovecha casi todo el lienzo (más zoom = más detalle legible).
    setView(fitToBounds(latest.current.layout.bounds, size.w, size.h, FIT_PADDING));
    autoFitRef.current = true;
  }, [setView]);

  const focusNodeInView = useCallback((id: string): boolean => {
    const b = latest.current.layout.nodes.find((n) => n.id === id);
    const { w, h } = sizeRef.current;
    if (!b || w <= 0 || h <= 0) return false;
    const scale = Math.max(viewRef.current.scale, 0.8);
    autoFitRef.current = false;
    setView({ scale, tx: w / 2 - (b.x + b.w / 2) * scale, ty: h / 2 - (b.y + b.h / 2) * scale });
    return true;
  }, [setView]);

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

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomBy(1.25),
      zoomOut: () => zoomBy(1 / 1.25),
      fit,
      focusNode: (id: string) => {
        if (focusNodeInView(id)) return;
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
      getSnapshot: () => ({ view: { ...viewRef.current }, overrides: overridesToRecord(latest.current.overrides) }),
      resetPositions: () => setOverrides(EMPTY_OVERRIDES),
      hasManualPositions: () => hasOverrides(latest.current.overrides),
    }),
    [zoomBy, fit, focusNodeInView, updateCollapsed, themeOf],
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

  // Tamaño del contenedor.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const apply = (): void => {
      const w = Math.max(0, Math.floor(wrap.clientWidth));
      const h = Math.max(0, Math.floor(wrap.clientHeight));
      const first = !canPaint(sizeRef.current);
      sizeRef.current = { w, h };
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      // Si la vista no la ha tocado el usuario, se vuelve a encuadrar: el panel puede crecer después del
      // primer encuadre (paneles laterales, barra de herramientas) y el diagrama quedaba pequeño y corrido.
      if ((first || autoFitRef.current) && w > 0 && h > 0) fit();
      else schedule();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit, schedule]);

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
    if (pending && !(controlled && pending.from === layout)) {
      pendingFitRef.current = null;
      fit();
    }
    const id = pendingFocusRef.current;
    if (id && focusNodeInView(id)) pendingFocusRef.current = null;
  }, [layout, collapsedPackages, controlled, fit, focusNodeInView]);

  // Cualquier cambio de lo que se dibuja ⇒ repintar.
  useEffect(() => {
    schedule();
  }, [visibleLayout, selectedId, model, focus, liveHover, display, labels, packageCounts, schedule]);

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
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Sobre una tarjeta (no un paquete plegado) se arrastra la tarjeta.
    const rect = e.currentTarget.getBoundingClientRect();
    const p = screenToWorld(viewRef.current, e.clientX - rect.left, e.clientY - rect.top);
    const L = latest.current;
    const hit = hitTestNode(L.index, L.layout, p.x, p.y);
    const nodeId = hit !== null && !isPackageNode(hit) ? hit : null;
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
      if (d.nodeId !== null) setDraggingNode(true);
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
      setEdgeSel({ layout: L.sourceLayout, index: hit.index });
      L.onSelect?.(null);
      return;
    }
    setEdgeSel(null);
    L.onSelect?.(hit?.kind === 'node' ? hit.id : null);
  };

  const onPointerLeave = (): void => {
    if (!dragRef.current && latest.current.hover !== null) setHover(null);
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = screenToWorld(viewRef.current, e.clientX - rect.left, e.clientY - rect.top);
    const L = latest.current;
    if (hitTestNode(L.index, L.layout, p.x, p.y) === null && !hitTestPackageHeader(L.layout, p.x, p.y)) fit();
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
      const nameOf = (id: string): string => typeById.get(id)?.name ?? (isPackageNode(id) ? packageNodeName(id) : id);
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
      <div ref={tipRef} className="diagram-tooltip" role="tooltip" hidden={tip === null}>
        {tip}
      </div>
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
