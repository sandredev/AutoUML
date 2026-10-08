// src/render/canvas/DiagramCanvas.tsx — componente React del lienzo.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Category, DiagramModel } from '../../core/model';
import type { LayoutResult, ViewState } from '../types';
import { drawDiagram, type Theme } from './draw';
import { collapsePackages, hitTestPackageHeader, PACKAGE_NODE_PREFIX } from './collapse';
import { drawMinimap } from './minimap';
import { applyOverrides, EMPTY_OVERRIDES, hasOverrides, moveBy, type Overrides } from './overrides';
import { buildIndex, hitTestNode } from './spatial';
import { canPaint, fitToBounds, panBy, screenToWorld, zoomAt } from './viewport';

export interface DiagramCanvasHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  focusNode(id: string): void;
  exportPng(): Promise<Blob | null>;
  /** Devuelve las tarjetas movidas a mano a la posición que calculó el layout. */
  resetPositions(): void;
  /** true si hay alguna tarjeta movida a mano. */
  hasManualPositions(): boolean;
}

interface Props {
  model: DiagramModel;
  layout: LayoutResult;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onViewChange?: (v: ViewState) => void;
  /** Se llama cuando cambia si hay tarjetas movidas a mano (para habilitar "Restablecer"). */
  onManualPositionsChange?: (has: boolean) => void;
}

const CATEGORIES: Category[] = ['sealed', 'abstract', 'interface', 'enum', 'record', 'annotation', 'class', 'external', 'undeclared'];
const MAX_EXPORT_SIDE = 16384;
const DRAG_THRESHOLD = 4;

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

function readTheme(el: HTMLElement): Theme {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  const cat = {} as Record<Category, string>;
  for (const c of CATEGORIES) cat[c] = v(`--cat-${c}`, '#57606a');
  return {
    bg: v('--bg-elev', '#ffffff'),
    fg: v('--fg', '#1f2328'),
    muted: v('--fg-muted', '#656d76'),
    border: v('--border', '#d0d7de'),
    accent: v('--accent', '#0969da'),
    cat,
  };
}

export const DiagramCanvas = forwardRef<DiagramCanvasHandle, Props>(function DiagramCanvas(
  { model, layout, selectedId = null, onSelect, onViewChange, onManualPositionsChange },
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
  // Arrastre: 'pan' mueve la vista; 'node' mueve una tarjeta (nodeId).
  const dragRef = useRef<{ id: number; x: number; y: number; moved: boolean; nodeId: string | null } | null>(null);
  const paintErrorRef = useRef<string | null>(null);
  const [collapsedPackages, setCollapsedPackages] = useState<Set<string>>(() => new Set());
  const [paintError, setPaintError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Overrides>(EMPTY_OVERRIDES);
  const [draggingNode, setDraggingNode] = useState(false);

  // Un layout nuevo (recalculado) descarta las posiciones manuales.
  const [overridesFor, setOverridesFor] = useState(layout);
  if (overridesFor !== layout) {
    setOverridesFor(layout);
    setOverrides(EMPTY_OVERRIDES);
  }

  const movedLayout = useMemo(() => applyOverrides(layout, overrides), [layout, overrides]);
  const visibleLayout = useMemo(() => collapsePackages(model, movedLayout, collapsedPackages), [model, movedLayout, collapsedPackages]);
  const index = useMemo(() => buildIndex(visibleLayout), [visibleLayout]);

  // Siempre las últimas props para los callbacks estables.
  const latest = useRef({ model, layout: visibleLayout, index, selectedId, onSelect, onViewChange, collapsedPackages, overrides });
  latest.current = { model, layout: visibleLayout, index, selectedId, onSelect, onViewChange, collapsedPackages, overrides };

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
      });
      const minimap = minimapRef.current;
      if (minimap) drawMinimap(minimap, L.model, L.layout, viewRef.current, size.w, size.h, themeRef.current);
      reportPaint(null);
    } catch (err) {
      console.error('[DiagramCanvas] Error al dibujar', err);
      reportPaint(errorText(err));
    }
  }, [reportPaint]);

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
    setView(fitToBounds(latest.current.layout.bounds, size.w, size.h));
  }, [setView]);

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

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomBy(1.25),
      zoomOut: () => zoomBy(1 / 1.25),
      fit,
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
      resetPositions: () => setOverrides(EMPTY_OVERRIDES),
      hasManualPositions: () => hasOverrides(latest.current.overrides),
    }),
    [zoomBy, fit, setView, focusNodeInView],
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

  // Nuevo layout o paquetes contraídos ⇒ ajustar. (Mover tarjetas NO reencuadra la vista.)
  useEffect(() => {
    fit();
    const pending = pendingFocusRef.current;
    if (pending && focusNodeInView(pending)) pendingFocusRef.current = null;
  }, [layout, collapsedPackages, fit, focusNodeInView]);

  // Tarjetas movidas ⇒ repintar.
  useEffect(() => {
    schedule();
  }, [visibleLayout, schedule]);

  // Selección o modelo cambian ⇒ repintar.
  useEffect(() => {
    schedule();
  }, [selectedId, model, schedule]);

  // Tema claro/oscuro.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      themeRef.current = null;
      schedule();
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
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

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Sobre una tarjeta (no un paquete contraído ni la franja del nombre de un paquete) se arrastra la tarjeta.
    const rect = e.currentTarget.getBoundingClientRect();
    const p = screenToWorld(viewRef.current, e.clientX - rect.left, e.clientY - rect.top);
    const L = latest.current;
    const hit = hitTestNode(L.index, L.layout, p.x, p.y);
    const nodeId = hit !== null && !hit.startsWith(PACKAGE_NODE_PREFIX) ? hit : null;
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, nodeId };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved && d.nodeId !== null) setDraggingNode(true);
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.nodeId !== null) {
      const s = viewRef.current.scale || 1;
      const id = d.nodeId;
      setOverrides((prev) => moveBy(prev, id, dx / s, dy / s));
      return;
    }
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
    const p = screenToWorld(viewRef.current, e.clientX - rect.left, e.clientY - rect.top);
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

  const onDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = screenToWorld(viewRef.current, e.clientX - rect.left, e.clientY - rect.top);
    const L = latest.current;
    if (hitTestNode(L.index, L.layout, p.x, p.y) === null && !hitTestPackageHeader(L.layout, p.x, p.y)) fit();
  };

  return (
    <div ref={wrapRef} className={draggingNode ? 'diagram-canvas is-dragging-node' : 'diagram-canvas'}>
      <canvas
        ref={canvasRef}
        aria-label="Diagrama de clases. Arrastra una tarjeta para moverla o el fondo para mover la vista. Haz clic en el encabezado de un paquete para contraerlo y en su tarjeta para expandirlo."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      />
      <canvas ref={minimapRef} className="diagram-minimap" aria-label="Minimapa del diagrama" />
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
