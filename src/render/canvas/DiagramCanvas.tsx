// src/render/canvas/DiagramCanvas.tsx — componente React del lienzo.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Category, DiagramModel } from '../../core/model';
import type { LayoutResult, ViewState } from '../types';
import { drawDiagram, type Theme } from './draw';
import { collapsePackages, hitTestPackageHeader, PACKAGE_NODE_PREFIX } from './collapse';
import { drawMinimap } from './minimap';
import { buildIndex, hitTestNode } from './spatial';
import { fitToBounds, panBy, screenToWorld, zoomAt } from './viewport';

export interface DiagramCanvasHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  focusNode(id: string): void;
  exportPng(): Promise<Blob | null>;
}

interface Props {
  model: DiagramModel;
  layout: LayoutResult;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onViewChange?: (v: ViewState) => void;
}

const CATEGORIES: Category[] = ['sealed', 'abstract', 'interface', 'enum', 'record', 'annotation', 'class', 'external', 'undeclared'];
const MAX_EXPORT_SIDE = 16384;
const DRAG_THRESHOLD = 4;

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
  { model, layout, selectedId = null, onSelect, onViewChange },
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
  const dragRef = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const [collapsedPackages, setCollapsedPackages] = useState<Set<string>>(() => new Set());

  const visibleLayout = useMemo(() => collapsePackages(model, layout, collapsedPackages), [model, layout, collapsedPackages]);
  const index = useMemo(() => buildIndex(visibleLayout), [visibleLayout]);

  // Siempre las últimas props para los callbacks estables.
  const latest = useRef({ model, layout: visibleLayout, index, selectedId, onSelect, onViewChange, collapsedPackages });
  latest.current = { model, layout: visibleLayout, index, selectedId, onSelect, onViewChange, collapsedPackages };

  const paint = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const { w, h } = sizeRef.current;
    if (w <= 0 || h <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    themeRef.current ??= readTheme(wrap);
    const L = latest.current;
    drawDiagram(ctx, {
      model: L.model,
      layout: L.layout,
      index: L.index,
      view: viewRef.current,
      viewW: w,
      viewH: h,
      dpr: window.devicePixelRatio || 1,
      selectedId: L.selectedId,
      theme: themeRef.current,
    });
    const minimap = minimapRef.current;
    if (minimap) drawMinimap(minimap, L.model, L.layout, viewRef.current, w, h, themeRef.current);
  }, []);

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
    const { w, h } = sizeRef.current;
    if (w <= 0 || h <= 0) return;
    setView(fitToBounds(latest.current.layout.bounds, w, h));
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
      const first = sizeRef.current.w === 0;
      sizeRef.current = { w, h };
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (first && w > 0 && h > 0) fit();
      else schedule();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit, schedule]);

  // Nuevo layout ⇒ ajustar.
  useEffect(() => {
    fit();
    const pending = pendingFocusRef.current;
    if (pending && focusNodeInView(pending)) pendingFocusRef.current = null;
  }, [visibleLayout, fit, focusNodeInView]);

  // Selección o modelo cambian ⇒ repintar.
  useEffect(() => {
    schedule();
  }, [selectedId, model, schedule]);

  // Tema claro/oscuro: del sistema o forzado manual (data-theme, issue #1).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      themeRef.current = null;
      schedule();
    };
    mq.addEventListener('change', onChange);
    const observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => {
      mq.removeEventListener('change', onChange);
      observer.disconnect();
    };
  }, [schedule]);

  useEffect(
    () => () => {
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
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
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    setView(panBy(viewRef.current, dx, dy));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
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
    <div ref={wrapRef} className="diagram-canvas">
      <canvas
        ref={canvasRef}
        aria-label="Diagrama de clases. Arrastra para mover la vista. Haz clic en el encabezado de un paquete para contraerlo y en su tarjeta para expandirlo."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      />
      <canvas ref={minimapRef} className="diagram-minimap" aria-label="Minimapa del diagrama" />
    </div>
  );
});
