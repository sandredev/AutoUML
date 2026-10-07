import type { JSX, RefObject } from 'react';
import type { DiagramModel } from '../../core/model';
import type { ProjectInfo } from '../../shared/ipc';
import { PumlViewer } from '../../render/PumlViewer';
import type { DiagramCanvasHandle } from '../../render/canvas/DiagramCanvas';

interface Props {
  project: ProjectInfo | null;
  model: DiagramModel | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  canvasRef: RefObject<DiagramCanvasHandle | null>;
}

export function RenderArea({ project, model, selectedId, onSelect, canvasRef }: Props): JSX.Element {
  if (!project) return <main className="render-area" />;

  if (!project.puml) {
    return (
      <main className="render-area">
        <h1 className="render-title">Este es el nuevo proyecto</h1>
        <p className="render-meta">Usa Cargar PUML (Ctrl+O) para empezar</p>
      </main>
    );
  }

  return (
    <main className="render-area has-canvas">
      <PumlViewer
        model={model}
        selectedId={selectedId}
        onSelect={onSelect}
        canvasRef={canvasRef}
        className="render-area-content"
      />
    </main>
  );
}
