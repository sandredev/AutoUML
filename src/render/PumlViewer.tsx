import { useMemo, useState, type JSX, type RefObject } from 'react';
import type { DiagramModel } from '../core/model';
import { DiagramCanvas, type DiagramCanvasHandle } from './canvas/DiagramCanvas';
import { useLayout } from './layout/useLayout';
import { ViewOptionsBar } from './ViewOptionsBar';
import { applyViewOptions, loadViewOptions, saveViewOptions, toLayoutOptions, type ViewOptions } from './viewOptions';

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
  const [viewOptions, setViewOptions] = useState<ViewOptions>(() => loadViewOptions());
  const viewModel = useMemo(() => (model ? applyViewOptions(model, viewOptions) : null), [model, viewOptions]);
  const viewLayoutOptions = useMemo(
    () => (viewModel ? toLayoutOptions(viewOptions, viewModel) : undefined),
    [viewOptions, viewModel],
  );
  const { layout, loading, error } = useLayout(viewModel, viewLayoutOptions);
  const classes = `puml-viewer ${className}`.trim();

  const handleViewOptionsChange = (next: ViewOptions): void => {
    setViewOptions(next);
    saveViewOptions(next);
  };

  if (error) {
    return (
      <section className={classes}>
        <h2 className="render-title">No se pudo calcular el diagrama</h2>
        <p className="render-meta" role="alert">{error}</p>
      </section>
    );
  }

  if (!viewModel || loading || !layout) {
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
      <ViewOptionsBar value={viewOptions} onChange={handleViewOptionsChange} disabled={loading} />
      <DiagramCanvas
        ref={canvasRef}
        model={viewModel}
        layout={layout}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    </section>
  );
}
