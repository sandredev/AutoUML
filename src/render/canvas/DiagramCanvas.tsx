// src/render/canvas/DiagramCanvas.tsx — componente React del lienzo.
// S4: hover con resaltado, minimapa navegable, atajos de teclado y tema reactivo.
// S6: arrastre de entidades con reasignación de paquetes, reajuste local y persistencia.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type { Category, DiagramModel } from '../../core/model';
import type { EdgePath, LayoutResult, NodeBox, ViewState } from '../types';
import { CARD } from '../style/contract';
import { drawDiagram, type Theme } from './draw';
import { collapsePackages, hitTestPackageHeader, PACKAGE_NODE_PREFIX } from './collapse';
import { drawMinimap } from './minimap';
import { buildIndex, hitTestNode, type SpatialIndex } from './spatial';
import { canPaint, fitToBounds, panBy, screenToWorld, zoomAt } from './viewport';
import { easeOutCubic, finalizeDrop, interpolateLayout, moveNodePreview, packageAt } from './dragNode';
import { applyOverrides, diffOverrides, emptyOverrides, hasOverrides, parseOverrides, pruneOverrides, serializeOverrides, storageKeyFor, type LayoutOverrides } from './overrides';

export interface DiagramCanvasHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  focusNode(id: string): void;
  exportPng(): Promise<Blob | null>;
  resetLayout(): void;
}

interface Props {
  model: DiagramModel;
  layout: LayoutResult;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onViewChange?: (v: ViewState) => void;
  storageKey?: string;
}

type Gesture =
  | { kind: 'pan'; id: number; x: number; y: number; moved: boolean }
  | { kind: 'node'; id: number; nodeId: string; sx: number; sy: number; grabX: number; grabY: number; nx: number; ny: number; px: number; py: number; moved: boolean };

const CATEGORIES: Category[] = ['sealed', 'abstract', 'interface', 'enum', 'record', 'annotation', 'class', 'external', 'undeclared'];
const MAX_EXPORT_SIDE = 16384;
const DRAG_THRESHOLD = 4;
const zoomStep = 1.25;
const keyPanPx = 60;
const minimapPad = 8;
const animMs = 200;

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

function readTheme(el: HTMLElement): Theme {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  const cat = {} as Record<Category, string>;
  for (const c of CATEGORIES) cat[c] = v('--cat-' + c, '#57606a');
  return {
    bg: v('--bg-elev', '#ffffff'),
    fg: v('--fg', '#1f2328'),
    muted: v('--fg-muted', '#656d76'),
    border: v('--border', '#d0d7de'),
    accent: v('--accent', '#0969da'),
    cat,
  };
}

function loadOverrides(key: string, model: DiagramModel): LayoutOverrides {
  try {
    return pruneOverrides(model, parseOverrides(window.localStorage.getItem(key)));
  } catch {
    return emptyOverrides();
  }
}

function saveOverrides(key: string, o: LayoutOverrides): void {
  try {
    if (hasOverrides(o)) window.localStorage.setItem(key, serializeOverrides(o));
    else window.localStorage.removeItem(key);
  } catch (err) {
    console.warn('[DiagramCanvas] No se pudo guardar la disposición', err);
  }
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Misma transformación que usa drawMinimap (pad 8, centrado), invertida.
function minimapToWorldPoint(canvas: HTMLCanvasElement, layout: LayoutResult, mx: number, my: number): { x: number; y: number } | null {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const b = layout.bounds;
  if (w <= 0 || h <= 0 || b.w <= 0 || b.h <= 0) return null;
  const sc = Math.min((w - minimapPad * 2) / b.w, (h - minimapPad * 2) / b.h);
  if (!(sc > 0) || !Number.isFinite(sc)) return null;
  const ox = (w - b.w * sc) / 2 - b.x * sc;
  const oy = (h - b.h * sc) / 2 - b.y * sc;
  return { x: (mx - ox) / sc, y: (my - oy) / sc };
}

// Curva suave por puntos medios (igual criterio que el dibujo base).
function traceSmooth(ctx: CanvasRenderingContext2D, pts: number[]): void {
  const n = pts.length >> 1;
  if (n < 2) return;
  ctx.moveTo(pts[0] ?? 0, pts[1] ?? 0);
  if (n === 2) {
    ctx.lineTo(pts[2] ?? 0, pts[3] ?? 0);
    return;
  }
  for (let i = 1; i < n - 1; i++) {
    const x = pts[i * 2] ?? 0;
    const y = pts[i * 2 + 1] ?? 0;
    const nx = pts[i * 2 + 2] ?? 0;
    const ny = pts[i * 2 + 3] ?? 0;
    const last = i === n - 2;
    ctx.quadraticCurveTo(x, y, last ? nx : (x + nx) / 2, last ? ny : (y + ny) / 2);
  }
}

function drawHoverOverlay(
  ctx: CanvasRenderingContext2D,
  box: NodeBox,
  edges: EdgePath[],
  view: ViewState,
  dpr: number,
  color: string,
): void {
  const s = view.scale;
  const px = 1 / s;
  ctx.save();
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * view.tx, dpr * view.ty);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * px;
  for (const e of edges) {
    if (e.type === 'IMPLEMENTS' || e.type === 'DEPENDENCY') ctx.setLineDash([5 * px, 4 * px]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    traceSmooth(ctx, e.points);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineWidth = 2.5 * px;
  ctx.beginPath();
  ctx.roundRect(box.x - 1.5 * px, box.y - 1.5 * px, box.w + 3 * px, box.h + 3 * px, CARD.radius);
  ctx.stroke();
  ctx.restore();
}

export const DiagramCanvas = forwardRef<DiagramCanvasHandle, Props>(function DiagramCanvas(
  { model, layout, selectedId = null, onSelect, onViewChange, storageKey },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewState>({ scale: 1, tx: 0, ty: 0 });
  const pendingFocusRef = useRef<string | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const themeRef = useRef<Theme | null>(null);
  const rafRef = useRef(0);
  const animRef = useRef(0);
  const gestureRef = useRef<Gesture | null>(null);
  const miniDragRef = useRef<number | null>(null);
  const hoverRef = useRef<string | null>(null);
  const previewRef = useRef<{ layout: LayoutResult; index: SpatialIndex } | null>(null);
  const paintErrorRef = useRef<string | null>(null);
  const [collapsedPackages, setCollapsedPackages] = useState<Set<string>>(() => new Set());
  const [paintError, setPaintError] = useState<string | null>(null);
  const key = storageKey ?? storageKeyFor(model);
  const [overrides, setOverrides] = useState<LayoutOverrides>(() => loadOverrides(key, model));

  const effectiveLayout = useMemo(() => applyOverrides(model, layout, overrides), [model, layout, overrides]);
  const visibleLayout = useMemo(() => collapsePackages(model, effectiveLayout, collapsedPackages), [model, effectiveLayout, collapsedPackages]);
  const index = useMemo(() => buildIndex(visibleLayout), [visibleLayout]);
  const nodeById = useMemo(() => new Map(visibleLayout.nodes.map((n) => [n.id, n])), [visibleLayout]);
  const incident = useMemo(() => {
    const m = new Map<string, EdgePath[]>();
    for (const e of visibleLayout.edges) {
      const a = m.get(e.source) ?? [];
      a.push(e);
      m.set(e.source, a);
      if (e.target !== e.source) {
        const b = m.get(e.target) ?? [];
        b.push(e);
        m.set(e.target, b);
      }
    }
    return m;
  }, [visibleLayout]);

  // Siempre las últimas props para los callbacks estables.
  const latest = useRef({ model, base: layout, effective: effectiveLayout, layout: visibleLayout, index, nodeById, incident, selectedId, onSelect, onViewChange, collapsedPackages, key });
  latest.current = { model, base: layout, effective: effectiveLayout, layout: visibleLayout, index, nodeById, incident, selectedId, onSelect, onViewChange, collapsedPackages, key };

  const reportPaint = useCallback((msg: string | null) => {
    if (paintErrorRef.current === msg) return;
    paintErrorRef.current = msg;
    setPaintError(msg);
  }, []);

  const paint = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const size = sizeRef.current;
    if (!canPaint(size)) return;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reportPaint('No se pudo obtener el contexto 2D del lienzo.');
        return;
      }
      themeRef.current ??= readTheme(wrap);
      const L = latest.current;
      const dpr = window.devicePixelRatio || 1;
      const pv = previewRef.current;
      const lay = pv ? pv.layout : L.layout;
      const idx = pv ? pv.index : L.index;
      drawDiagram(ctx, {
        model: L.model,
        layout: lay,
        index: idx,
        view: viewRef.current,
        viewW: size.w,
        viewH: size.h,
        dpr,
        selectedId: L.selectedId,
        theme: themeRef.current,
      });
      const hid = hoverRef.current;
      const hbox = hid !== null ? lay.nodes.find((n) => n.id === hid) : undefined;
      if (hbox) {
        const incidentEdges = lay.edges.filter((e) => e.source === hbox.id || e.target === hbox.id);
        drawHoverOverlay(ctx, hbox, incidentEdges, viewRef.current, dpr, themeRef.current.accent);
      }
      const minimap = minimapRef.current;
      if (minimap) drawMinimap(minimap, L.model, lay, viewRef.current, size.w, size.h, themeRef.current);
      reportPaint(null);
    } catch (err) {
      console.error('[DiagramCanvas] Error al dibujar', err);
      reportPaint(errorText(err));
    }
  }, [reportPaint]);

  const schedule = useCallback(() => {
    if (rafRef.current === 0) rafRef.current = requestAnimationFrame(paint);
  }, [paint]);

  const setPreview = useCallback((l: LayoutResult | null) => {
    previewRef.current = l ? { layout: l, index: buildIndex(l) } : null;
    schedule();
  }, [schedule]);

  const stopAnimation = useCallback(() => {
    if (animRef.current !== 0) cancelAnimationFrame(animRef.current);
    animRef.current = 0;
  }, []);

  const animate = useCallback((from: LayoutResult, to: LayoutResult) => {
    stopAnimation();
    if (reducedMotion()) {
      setPreview(null);
      return;
    }
    const start = performance.now();
    const step = (now: number): void => {
      const t = (now - start) / animMs;
      if (t >= 1) {
        animRef.current = 0;
        setPreview(null);
        return;
      }
      setPreview(interpolateLayout(from, to, easeOutCubic(t)));
      animRef.current = requestAnimationFrame(step);
    };
    setPreview(from);
    animRef.current = requestAnimationFrame(step);
  }, [setPreview, stopAnimation]);

  const setView = useCallback(
    (v: ViewState) => {
      viewRef.current = v;
      latest.current.onViewChange?.(v);
      schedule();
    },
    [schedule],
  );

  const setHover = useCallback(
    (id: string | null) => {
      if (hoverRef.current === id) return;
      hoverRef.current = id;
      const canvas = canvasRef.current;
      if (canvas && !gestureRef.current) canvas.style.cursor = id !== null ? 'pointer' : '';
      schedule();
    },
    [schedule],
  );

  const fit = useCallback(() => {
    const size = sizeRef.current;
    if (!canPaint(size)) return;
    setView(fitToBounds(latest.current.layout.bounds, size.w, size.h));
  }, [setView]);

  const centerOn = useCallback(
    (x: number, y: number) => {
      const { w, h } = sizeRef.current;
      if (w <= 0 || h <= 0) return;
      const scale = viewRef.current.scale;
      setView({ scale, tx: w / 2 - x * scale, ty: h / 2 - y * scale });
    },
    [setView],
  );

  const focusNodeInView = useCallback((id: string): boolean => {
    const b = latest.current.layout.nodes.find((n) => n.id === id);
    const { w, h } = sizeRef.current;
    if (!b || w <= 0 || h <= 0) return false;
    const scale = Math.max(viewRef.current.scale, 0.8);
    setView({ scale, tx: w / 2 - (b.x + b.w / 2) * scale, ty: h / 2 - (b.y + b.h / 2) * scale });
    return true;
  }, [setView]);

  const zoomBy = useCallback(
    (factor: number) => {
      const { w, h } = sizeRef.current;
      setView(zoomAt(viewRef.current, factor, w / 2, h / 2));
    },
    [setView],
  );

  const commitOverrides = useCallback((next: LayoutOverrides, to: LayoutResult) => {
    const L = latest.current;
    const from = previewRef.current ? previewRef.current.layout : L.layout;
    saveOverrides(L.key, next);
    setOverrides(next);
    animate(from, to);
  }, [animate]);

  const resetLayout = useCallback(() => {
    const L = latest.current;
    const to = collapsePackages(L.model, applyOverrides(L.model, L.base, emptyOverrides()), L.collapsedPackages);
    commitOverrides(emptyOverrides(), to);
  }, [commitOverrides]);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomBy(zoomStep),
      zoomOut: () => zoomBy(1 / zoomStep),
      fit,
      resetLayout,
      focusNode: (id: string) => {
        if (focusNodeInView(id)) return;
        const type = latest.current.model.types.find((node) => node.id === id);
        if (type && latest.current.collapsedPackages.has(type.packageName)) {
          pendingFocusRef.current = id;
          setCollapsedPackages((previous) => {
            const next = new Set(previous);
            next.delete(type.packageName);
            return next;
          });
        }
      },
      exportPng: async () => {
        const wrap = wrapRef.current;
        const L = latest.current;
        const b = L.layout.bounds;
        if (!wrap || b.w <= 0 || b.h <= 0) return null;
        const pad = 32;
        const worldW = b.w + 2 * pad;
        const worldH = b.h + 2 * pad;
        const scale = Math.min(2, MAX_EXPORT_SIDE / worldW, MAX_EXPORT_SIDE / worldH);
        const off = document.createElement('canvas');
        off.width = Math.max(1, Math.floor(worldW * scale));
        off.height = Math.max(1, Math.floor(worldH * scale));
        const ctx = off.getContext('2d');
        if (!ctx) return null;
        drawDiagram(ctx, {
          model: L.model,
          layout: L.layout,
          index: L.index,
          view: { scale, tx: (pad - b.x) * scale, ty: (pad - b.y) * scale },
          viewW: off.width,
          viewH: off.height,
          dpr: 1,
          selectedId: null,
          theme: readTheme(wrap),
        });
        return new Promise<Blob | null>((resolve) => off.toBlob((blob) => resolve(blob), 'image/png'));
      },
    }),
    [zoomBy, fit, resetLayout, focusNodeInView],
  );

  const togglePackage = useCallback((name: string) => {
    setCollapsedPackages((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

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
      if (first && w > 0 && h > 0) fit();
      else schedule();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit, schedule]);

  // Nuevo layout automático o cambio de colapso ⇒ ajustar (un arrastre NO reajusta la vista).
  useEffect(() => {
    fit();
  }, [layout, collapsedPackages, fit]);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (pending && focusNodeInView(pending)) pendingFocusRef.current = null;
    schedule();
  }, [visibleLayout, focusNodeInView, schedule]);

  // Selección o modelo cambian ⇒ repintar.
  useEffect(() => {
    schedule();
  }, [selectedId, model, schedule]);

  // Cambia el modelo o la clave ⇒ cargar disposición guardada.
  useEffect(() => {
    stopAnimation();
    previewRef.current = null;
    gestureRef.current = null;
    setOverrides(loadOverrides(key, model));
  }, [key, model, stopAnimation]);

  // Tema: preferencia del sistema y cambios de tema de la app (clase/atributo en html o body).
  useEffect(() => {
    const reset = (): void => {
      themeRef.current = null;
      schedule();
    };
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', reset);
    const mo = new MutationObserver(reset);
    const filter = { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] };
    mo.observe(document.documentElement, filter);
    if (document.body) mo.observe(document.body, filter);
    return () => {
      mq.removeEventListener('change', reset);
      mo.disconnect();
    };
  }, [schedule]);

  useEffect(
    () => () => {
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
      // Con StrictMode el efecto se desmonta y se vuelve a montar: un rafRef distinto de 0 bloquearía schedule().
      rafRef.current = 0;
      if (animRef.current !== 0) cancelAnimationFrame(animRef.current);
      animRef.current = 0;
    },
    [],
  );

  useEffect(() => {
    const known = new Set(model.packages.map((pkg) => pkg.name));
    setCollapsedPackages((previous) => {
      const next = new Set([...previous].filter((name) => known.has(name)));
      return next.size === previous.size ? previous : next;
    });
  }, [model]);

  // Rueda: listener nativo no pasivo para poder hacer preventDefault.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      setView(zoomAt(viewRef.current, factor, e.clientX - rect.left, e.clientY - rect.top));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [setView]);

  const worldAt = (e: ReactPointerEvent<HTMLCanvasElement> | ReactMouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return screenToWorld(viewRef.current, e.clientX - rect.left, e.clientY - rect.top);
  };

  const finishNodeDrag = useCallback((g: Extract<Gesture, { kind: 'node' }>): void => {
    const L = latest.current;
    const target = packageAt(L.effective.packages, g.px, g.py);
    const final = finalizeDrop(L.effective, g.nodeId, g.nx, g.ny, target);
    const base = applyOverrides(L.model, L.base, emptyOverrides());
    const next = pruneOverrides(L.model, diffOverrides(L.model, base, final));
    commitOverrides(next, collapsePackages(L.model, final, L.collapsedPackages));
    L.onSelect?.(g.nodeId);
  }, [commitOverrides]);

  const cancelNodeDrag = useCallback((g: Extract<Gesture, { kind: 'node' }>): void => {
    if (g.moved) animate(previewRef.current ? previewRef.current.layout : latest.current.layout, latest.current.layout);
    else setPreview(null);
  }, [animate, setPreview]);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return;
    wrapRef.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    stopAnimation();
    previewRef.current = null;
    setHover(null);
    const L = latest.current;
    const p = worldAt(e);
    const onHeader = hitTestPackageHeader(L.layout, p.x, p.y) !== null;
    const nodeId = onHeader ? null : hitTestNode(L.index, L.layout, p.x, p.y);
    const box = nodeId && !nodeId.startsWith(PACKAGE_NODE_PREFIX) ? L.layout.nodes.find((n) => n.id === nodeId) : undefined;
    if (box) {
      gestureRef.current = { kind: 'node', id: e.pointerId, nodeId: box.id, sx: e.clientX, sy: e.clientY, grabX: p.x - box.x, grabY: p.y - box.y, nx: box.x, ny: box.y, px: p.x, py: p.y, moved: false };
      return;
    }
    gestureRef.current = { kind: 'pan', id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const g = gestureRef.current;
    if (!g) {
      const p = worldAt(e);
      setHover(hitTestNode(latest.current.index, latest.current.layout, p.x, p.y));
      return;
    }
    if (g.id !== e.pointerId) return;
    if (g.kind === 'pan') {
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      g.moved = true;
      g.x = e.clientX;
      g.y = e.clientY;
      setView(panBy(viewRef.current, dx, dy));
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_THRESHOLD) return;
    if (!g.moved) {
      g.moved = true;
      setHover(null);
      e.currentTarget.style.cursor = 'grabbing';
    }
    const p = worldAt(e);
    g.px = p.x;
    g.py = p.y;
    g.nx = p.x - g.grabX;
    g.ny = p.y - g.grabY;
    setPreview(moveNodePreview(latest.current.layout, g.nodeId, g.nx, g.ny));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const g = gestureRef.current;
    if (!g || g.id !== e.pointerId) return;
    gestureRef.current = null;
    e.currentTarget.style.cursor = '';
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (e.type === 'pointercancel') {
      if (g.kind === 'node' && g.moved) setPreview(null);
      return;
    }
    if (g.kind === 'node' && g.moved) {
      finishNodeDrag(g);
      return;
    }
    if (g.moved) return;
    const p = worldAt(e);
    const L = latest.current;
    const packageName = hitTestPackageHeader(L.layout, p.x, p.y);
    if (packageName) {
      togglePackage(packageName);
      return;
    }
    const nodeId = hitTestNode(L.index, L.layout, p.x, p.y);
    if (nodeId?.startsWith(PACKAGE_NODE_PREFIX)) {
      togglePackage(nodeId.slice(PACKAGE_NODE_PREFIX.length));
      return;
    }
    L.onSelect?.(nodeId);
  };

  const onPointerLeave = (): void => {
    if (!gestureRef.current) setHover(null);
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    const p = worldAt(e);
    const L = latest.current;
    if (hitTestNode(L.index, L.layout, p.x, p.y) === null && !hitTestPackageHeader(L.layout, p.x, p.y)) fit();
  };

  // Minimapa navegable: clic o arrastre centra la vista en el punto.
  const miniNavigate = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = minimapToWorldPoint(e.currentTarget, latest.current.layout, e.clientX - rect.left, e.clientY - rect.top);
    if (p) centerOn(p.x, p.y);
  };

  const onMiniDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    miniDragRef.current = e.pointerId;
    miniNavigate(e);
  };

  const onMiniMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (miniDragRef.current !== e.pointerId) return;
    miniNavigate(e);
  };

  const onMiniUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (miniDragRef.current !== e.pointerId) return;
    miniDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Teclado: + / - zoom, 0 o F ajustar, flechas mover, Escape deseleccionar (o cancelar arrastre).
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const g = gestureRef.current;
    if (e.key === 'Escape' && g && g.kind === 'node') {
      e.preventDefault();
      e.stopPropagation();
      gestureRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) {
        if (canvas.hasPointerCapture(g.id)) {
          try { canvas.releasePointerCapture(g.id); } catch { /* ya liberado */ }
        }
        canvas.style.cursor = '';
      }
      cancelNodeDrag(g);
      return;
    }
    if (e.altKey) return;
    let handled = true;
    switch (e.key) {
      case '+':
      case '=':
        zoomBy(zoomStep);
        break;
      case '-':
      case '_':
        zoomBy(1 / zoomStep);
        break;
      case '0':
        fit();
        break;
      case 'f':
      case 'F':
        if (e.ctrlKey || e.metaKey) handled = false;
        else fit();
        break;
      case 'ArrowLeft':
        setView(panBy(viewRef.current, keyPanPx, 0));
        break;
      case 'ArrowRight':
        setView(panBy(viewRef.current, -keyPanPx, 0));
        break;
      case 'ArrowUp':
        setView(panBy(viewRef.current, 0, keyPanPx));
        break;
      case 'ArrowDown':
        setView(panBy(viewRef.current, 0, -keyPanPx));
        break;
      case 'Escape':
        setHover(null);
        latest.current.onSelect?.(null);
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div ref={wrapRef} className="diagram-canvas" tabIndex={0} onKeyDown={onKeyDown}>
      <canvas
        ref={canvasRef}
        aria-label="Diagrama de clases. Arrastra una tarjeta para moverla a otro paquete, arrastra el fondo para mover la vista; + y - para zoom, 0 para ajustar, flechas para desplazar y Escape para deseleccionar o cancelar el arrastre. Haz clic en el encabezado de un paquete para contraerlo y en su tarjeta para expandirlo."
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
        aria-label="Minimapa del diagrama. Haz clic o arrastra para mover la vista."
        onPointerDown={onMiniDown}
        onPointerMove={onMiniMove}
        onPointerUp={onMiniUp}
        onPointerCancel={onMiniUp}
      />
      {paintError !== null && (
        <p
          className="render-meta diagram-paint-error"
          role="alert"
          style={{ position: 'absolute', top: 8, left: 8, right: 8, margin: 0, padding: '6px 10px', background: 'var(--bg-elev, #fff)', border: '1px solid var(--border, #d0d7de)', color: 'var(--danger, #cf222e)' }}
        >
          {'No se pudo dibujar el diagrama: ' + paintError}
        </p>
      )}
    </div>
  );
});
