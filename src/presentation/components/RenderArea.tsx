import { useMemo, type JSX, type ReactNode, type RefObject } from 'react';
import type { DiagramModel } from '../../domain/diagram/model';
import type { ProjectInfo, SidecarState } from '../../application/ports/ipc';
import { PumlViewer } from '../diagram/PumlViewer';
import type { DiagramCanvasHandle } from '../diagram/canvas/DiagramCanvas';
import { useLocalization } from '../localization/LocalizationProvider';
import { viewerLabels } from '../localization/viewerLabels';

interface Props {
  project: ProjectInfo | null;
  model: DiagramModel | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  canvasRef: RefObject<DiagramCanvasHandle | null>;
  onLayoutLoadingChange?: (loading: boolean) => void;
  /** Se pinta encima del área de render (la intro de carga). */
  children?: ReactNode;
  onNewProject?: () => void;
  onOpenProject?: () => void;
  /** Identidad del documento abierto: recargarlo conserva la vista y las posiciones manuales. */
  docKey?: string;
  /** Estado persistido del sidecar (colapsados, overrides, vista). */
  initialSidecar?: SidecarState | null;
  /** Avisa cuando cambian colapsados, posiciones manuales o vista (para persistir). */
  onViewStateChange?: (collapsed: ReadonlySet<string>) => void;
}

export function RenderArea({
  project,
  model,
  selectedId,
  onSelect,
  canvasRef,
  onLayoutLoadingChange,
  children,
  onNewProject,
  onOpenProject,
  docKey,
  initialSidecar,
  onViewStateChange,
}: Props): JSX.Element {
  const { t } = useLocalization();
  const labels = useMemo(() => viewerLabels(t), [t]);
  if (!project && !model) {
    return (
      <main className="render-area">
        <h1 className="render-title">AutoUML</h1>
        <p className="render-meta">{t('start.subtitle')}</p>
        {onNewProject && onOpenProject && (
          <div className="render-actions">
            <button type="button" className="btn btn-primary" onClick={onOpenProject}>
              {t('start.load')} — {t('start.openExisting')}
            </button>
            <button type="button" className="btn" onClick={onNewProject}>
              {t('start.new')} — {t('start.createEmpty')}
            </button>
          </div>
        )}
        {children}
      </main>
    );
  }

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
        labels={labels}
        {...(docKey !== undefined ? { docKey } : {})}
        {...(initialSidecar !== undefined ? { initialSidecar } : {})}
        {...(onViewStateChange ? { onViewStateChange } : {})}
      />
      {children}
    </main>
  );
}
