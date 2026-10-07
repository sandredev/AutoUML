import type { JSX, RefObject } from 'react';
import type { DiagramModel } from '../core/model';
import { DiagramCanvas, type DiagramCanvasHandle } from './canvas/DiagramCanvas';
import { useLayout } from './layout/useLayout';

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
}

export function PumlViewer({
  model,
  selectedId = null,
  onSelect,
  canvasRef,
  className = '',
}: PumlViewerProps): JSX.Element {
  const { layout, loading, error } = useLayout(model);
  const classes = `puml-viewer ${className}`.trim();

  if (error) {
    return (
      <section className={classes}>
        <h2 className="render-title">No se pudo calcular el diagrama</h2>
        <p className="render-meta" role="alert">{error}</p>
      </section>
    );
  }

  if (!model || loading || !layout) {
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
      <DiagramCanvas
        ref={canvasRef}
        model={model}
        layout={layout}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    </section>
  );
}
