import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, RefObject } from 'react';
import type { DiagramModel } from '../core/model';
import { DiagramCanvas, type DiagramCanvasHandle } from './canvas/DiagramCanvas';
import { DEFAULT_LABELS, fill, type ViewerLabels } from './labels';
import { useDiagramLayout } from './layout/useDiagramLayout';
import type { LayoutOptions } from './types';
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
}

const NO_COLLAPSED: ReadonlySet<string> = new Set();

export function PumlViewer({
  model,
  selectedId = null,
  onSelect,
  canvasRef,
  className = '',
  onLayoutLoadingChange,
  docKey,
  labels = DEFAULT_LABELS,
}: PumlViewerProps): JSX.Element {
  const [view, setView] = useState<ViewOptionsState>(initialViewOptions);
  const [manual, setManual] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(NO_COLLAPSED);

  // Paquetes plegados que siguen existiendo en el modelo (derivado: sin efecto ni render extra).
  const liveCollapsed = useMemo(() => {
    if (!model || collapsed.size === 0) return NO_COLLAPSED;
    const known = new Set(model.packages.map((p) => p.name));
    const next = new Set([...collapsed].filter((name) => known.has(name)));
    return next.size === collapsed.size ? collapsed : next;
  }, [model, collapsed]);

  const moreTemplate = labels.moreMembers;
  const options = useMemo<LayoutOptions>(() => ({ ...view.options, moreTemplate }), [view.options, moreTemplate]);
  const { layout, layoutModel, viewModel, packageCounts, display, loading, refining, error, engine, fallback, ms } =
    useDiagramLayout(model, liveCollapsed, options, view.layoutVersion);

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
        selectedId={selectedId}
        onSelect={onSelect}
        onManualPositionsChange={setManual}
        collapsedPackages={liveCollapsed}
        onCollapsedPackagesChange={handleCollapsed}
        packageCounts={packageCounts}
        skin={model.skinparams}
        display={display}
        labels={labels}
      />
    </section>
  );
}
