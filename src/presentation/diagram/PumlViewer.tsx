import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, RefObject } from 'react';
import type { DiagramModel } from '../../domain/diagram/model';
import type { SidecarState } from '../../application/ports/ipc';
import { DiagramCanvas, type DiagramCanvasHandle } from './canvas/DiagramCanvas';
import type { MenuAction, MenuSubject } from './contextMenu';
import { FiltersPanel, withListItem } from './FiltersPanel';
import { focusTargetOf, viewerShortcut } from './focusMode';
import { drawHiddenOf, hasActiveFilters, type DiagramFilters } from './graph/filters';
import { focusKey, type FocusDirection, type FocusSpec } from './graph/neighborhood';
import { DEFAULT_LABELS, fill, type ViewerLabels } from './labels';
import { isPackageNode, packageNodeName } from './layout/aggregate';
import { useDiagramLayout } from './layout/useDiagramLayout';
import type { LayoutOptions, ViewState } from './types';
import { initialViewOptions, resetViewOptions, type ViewOptionsState } from './viewOptions';

/**
 * Electron-independent view for the puml-viewer capability. The host owns
 * project selection, PUML loading, and model parsing; this component owns
 * layout and drawing.
 */
export interface PumlViewerProps {
  model: DiagramModel | null;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
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
  /** Avisa cuando cambian colapsados, filtros (T8), posiciones manuales o vista (para persistir). */
  onViewStateChange?: (collapsed: ReadonlySet<string>, filters: DiagramFilters) => void;
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
}

export type CodeTarget = { kind: 'type'; id: string } | { kind: 'relation'; line: number };

const NO_COLLAPSED: ReadonlySet<string> = new Set();
const NO_FILTERS: DiagramFilters = {};
const FOCUS_DEPTHS = [1, 2, 3] as const;
const FOCUS_DIRECTIONS: FocusDirection[] = ['both', 'out', 'in'];

export function PumlViewer({
  model,
  selectedId = null,
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
  }
  if (sidecarKey !== null && initialSidecar !== undefined && lastAppliedSidecar.current !== initialSidecar) {
    lastAppliedSidecar.current = initialSidecar;
    const known = model ? new Set(model.packages.map((p) => p.name)) : null;
    setCollapsed(new Set((initialSidecar?.collapsed ?? []).filter((name) => !known || known.has(name))));
    setFilters(initialSidecar?.filters ?? NO_FILTERS);
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
    layout, layoutModel, viewModel, packageCounts, display, loading, refining, error, engine, fallback, ms, focusableModel, focusApplied,
  } = useDiagramLayout(model, liveCollapsed, options, view.layoutVersion, focus, filters);
  // Filtros de dibujo sobre el modelo que se dibuja (no recalculan el layout).
  const drawHidden = useMemo(() => (viewModel ? drawHiddenOf(viewModel, filters) : null), [viewModel, filters]);
  // Paquetes del documento para las casillas del panel.
  const packageNames = useMemo(
    () => (model ? [...new Set(model.packages.map((p) => p.name))].sort((a, b) => a.localeCompare(b)) : []),
    [model],
  );

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

  // F enfoca la selección; Esc quita la ruta y, si no hay, sale del foco. Atajos de alta frecuencia: la
  // cámara no vuela (la transición del layout sí). No actúan escribiendo ni con un diálogo modal abierto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const shortcut = viewerShortcut(e);
      if (shortcut === null || document.querySelector('[aria-modal="true"]')) return;
      if (shortcut === 'focus') {
        if (enterFocus(false)) e.preventDefault();
        return;
      }
      if (handleRef.current?.clearRoute()) {
        e.preventDefault();
        return;
      }
      if (keyState.current.activeFocus !== null) {
        e.preventDefault();
        exitFocus(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enterFocus, exitFocus, handleRef]);

  /**
   * Restablecer: las tarjetas movidas vuelven a su posición, las opciones de vista a sus valores por defecto
   * y se fuerza un recálculo del layout (layoutVersion++). El encuadre se aplica aquí mismo de forma
   * imperativa; el layout recalculado no reencuadra solo (así el refinado dagre→ELK tampoco mueve la vista).
   */
  const handleReset = useCallback(() => {
    const canvas = handleRef.current;
    canvas?.resetPositions();
    canvas?.fit();
    setView((v) => resetViewOptions(v));
  }, [handleRef]);

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
  const canGoToCode = onGoToCode !== undefined;
  const menuContext = useMemo(() => ({ canGoToCode, hasFilters: filtersActive }), [canGoToCode, filtersActive]);

  // Aviso al host para persistir el sidecar (colapsados, posiciones manuales o vista).
  // El host lee el snapshot del canvas al guardar; aquí solo se le despierta (él hace debounce).
  const notifyRef = useRef(onViewStateChange);
  notifyRef.current = onViewStateChange;
  const persistRef = useRef({ collapsed: liveCollapsed, filters });
  persistRef.current = { collapsed: liveCollapsed, filters };
  const notify = useCallback(() => {
    notifyRef.current?.(persistRef.current.collapsed, persistRef.current.filters);
  }, []);
  useEffect(() => {
    notify();
  }, [liveCollapsed, filters, notify]);
  const handleManualPositions = useCallback((has: boolean) => {
    setManual(has);
    notify();
  }, [notify]);
  const handleViewChange = useCallback((_v: ViewState) => {
    notify();
  }, [notify]);

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

  const engineInfo = engine
    ? `${engine.toUpperCase()} · ${ms ?? 0} ms${refining ? ' · ' + labels.refining : ''}`
    : '';

  return (
    <section className={`${classes} has-canvas`}>
      <div className="puml-viewer-bar" role="toolbar" aria-label={labels.toolbarAria}>
        <span className="puml-viewer-bar-info" title={fallback} aria-live="polite">
          {loading ? labels.relayouting : fallback ? fill(labels.fallback, { reason: fallback }) : manual ? labels.manual : ''}
          {engineInfo ? <span className="puml-viewer-bar-engine"> · {engineInfo}</span> : null}
          {fallback ? <span className="puml-viewer-bar-warn" title={fallback}> {labels.fallbackBadge}</span> : null}
        </span>
        <FiltersPanel filters={filters} packages={packageNames} labels={labels} onChange={setFilters} />
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
            <button type="button" className="puml-viewer-reset" onClick={() => exitFocus(true)} title={labels.focusExitTitle}>
              {labels.focusExit}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="puml-viewer-reset"
            onClick={() => enterFocus(true)}
            disabled={focusTarget === null}
            title={labels.focusTitle}
            aria-keyshortcuts="F"
          >
            {labels.focus}
          </button>
        )}
        <button
          type="button"
          className="puml-viewer-reset"
          onClick={handleReset}
          disabled={loading}
          title={labels.resetTitle}
        >
          {labels.reset}
        </button>
      </div>
      <DiagramCanvas
        ref={handleRef}
        model={viewModel}
        sourceModel={model}
        layout={layout}
        layoutModel={layoutModel}
        {...(docKey !== undefined ? { docKey } : {})}
        {...(initialSidecar ? { initialOverrides: initialSidecar.overrides, initialView: initialSidecar.view } : {})}
        selectedId={selectedId}
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
      />
    </section>
  );
}
