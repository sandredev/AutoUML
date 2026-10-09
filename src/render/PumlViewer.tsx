import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, RefObject } from 'react';
import type { DiagramModel } from '../core/model';
import { DiagramCanvas, type DiagramCanvasHandle } from './canvas/DiagramCanvas';
import { useLayout } from './layout/useLayout';
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
}

export function PumlViewer({
  model,
  selectedId = null,
  onSelect,
  canvasRef,
  className = '',
  onLayoutLoadingChange,
}: PumlViewerProps): JSX.Element {
  const [view, setView] = useState<ViewOptionsState>(initialViewOptions);
  const [manual, setManual] = useState(false);
  const { layout, layoutModel, loading, error, fallback } = useLayout(model, view.options, view.layoutVersion);
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
   * y se fuerza un recálculo del layout (layoutVersion++). Al llegar el layout nuevo, el lienzo se reencuadra solo.
   */
  const handleReset = useCallback(() => {
    const canvas = handleRef.current;
    canvas?.resetPositions();
    canvas?.fit();
    setView((v) => resetViewOptions(v));
  }, [handleRef]);

  if (error) {
    return (
      <section className={classes}>
        <h2 className="render-title">No se pudo calcular el diagrama</h2>
        <p className="render-meta" role="alert">{error}</p>
      </section>
    );
  }

  // Mientras se recalcula el MISMO modelo (p. ej. tras "Restablecer") se sigue mostrando el diagrama anterior.
  const showable = model !== null && layout !== null && layoutModel === model;
  if (!showable) {
    return (
      <section className={classes}>
        <p className="render-meta" role="status">Calculando diagrama…</p>
      </section>
    );
  }

  if (layout.nodes.length === 0) {
    return (
      <section className={classes}>
        <h2 className="render-title">El diagrama está vacío</h2>
        <p className="render-meta">El archivo no contiene entidades reconocibles.</p>
      </section>
    );
  }

  return (
    <section className={`${classes} has-canvas`}>
      <div className="puml-viewer-bar" role="toolbar" aria-label="Vista del diagrama">
        <span className="puml-viewer-bar-info" title={fallback}>
          {loading ? 'Reorganizando…' : fallback ? `Diseño de respaldo (dagre): ${fallback}` : manual ? 'Posiciones modificadas a mano' : ''}
        </span>
        <button
          type="button"
          className="puml-viewer-reset"
          onClick={handleReset}
          disabled={loading}
          title="Devolver las tarjetas a su posición inicial y reorganizar el diagrama"
        >
          Restablecer
        </button>
      </div>
      <DiagramCanvas
        ref={handleRef}
        model={model}
        layout={layout}
        selectedId={selectedId}
        onSelect={onSelect}
        onManualPositionsChange={setManual}
      />
    </section>
  );
}
