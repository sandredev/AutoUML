import type { JSX, ReactNode, RefObject } from 'react';
import type { DiagramModel } from '../../core/model';
import type { ProjectInfo } from '../../shared/ipc';
import { PumlViewer } from '../../render/PumlViewer';
import type { DiagramCanvasHandle } from '../../render/canvas/DiagramCanvas';
import { useI18n } from '../i18n/I18nProvider';

interface Props {
  project: ProjectInfo | null;
  model: DiagramModel | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  canvasRef: RefObject<DiagramCanvasHandle | null>;
  onLayoutLoadingChange?: (loading: boolean) => void;
  /** Se pinta encima del área de render (la intro de carga). */
  children?: ReactNode;
}

export function RenderArea({
  project,
  model,
  selectedId,
  onSelect,
  canvasRef,
  onLayoutLoadingChange,
  children,
}: Props): JSX.Element {
  const { t } = useI18n();
  if (!project && !model) return <main className="render-area">{children}</main>;

  if (project && !project.puml && !model) {
    return (
      <main className="render-area">
        <h1 className="render-title">{t('render.newProject')}</h1>
        <p className="render-meta">{t('render.startHint')}</p>
        {children}
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
        onLayoutLoadingChange={onLayoutLoadingChange}
        className="render-area-content"
      />
      {children}
    </main>
  );
}
