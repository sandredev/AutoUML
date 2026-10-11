import { useMemo, type JSX, type ReactNode, type RefObject } from 'react';
import type { DiagramModel } from '../../domain/diagram/model';
import type { ProjectInfo, SidecarFilters, SidecarState, SidecarView } from '../../application/ports/ipc';
import { PumlViewer, type CodeTarget, type PaletteHost } from '../diagram/PumlViewer';
import type { DiagramCanvasHandle } from '../diagram/canvas/DiagramCanvas';
import { useLocalization } from '../localization/LocalizationProvider';
import { viewerLabels } from '../localization/viewerLabels';
import { isThemeMode, type ThemeMode } from '../../domain/rules/themes';
import { themeOptions } from './SettingsDialog';

interface Props {
  project: ProjectInfo | null;
  model: DiagramModel | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  canvasRef: RefObject<DiagramCanvasHandle | null>;
  /** Contenedor que pasa a pantalla completa (botón de ajustar del header). */
  areaRef?: RefObject<HTMLElement | null>;
  onLayoutLoadingChange?: (loading: boolean) => void;
  /** Se pinta encima del área de render (la intro de carga). */
  children?: ReactNode;
  /** Identidad del documento abierto: recargarlo conserva la vista y las posiciones manuales. */
  docKey?: string;
  /** Estado persistido del sidecar (colapsados, overrides, vista). */
  initialSidecar?: SidecarState | null;
  /** Avisa cuando cambian colapsados, posiciones manuales o vista (para persistir). */
  onViewStateChange?: (collapsed: ReadonlySet<string>, filters: SidecarFilters, views: readonly SidecarView[]) => void;
  /** Sincronización con el editor (T7). */
  highlightLine?: number | null;
  onRelationSelect?: (line: number | null) => void;
  onRename?: (id: string, next: string) => string | null;
  /** Menú contextual (T8): ir al código y copiar nombre. */
  onGoToCode?: (target: CodeTarget) => void;
  onCopyText?: (text: string) => void;
  /** Acciones de la app en la paleta (T10.2): exportar y cambiar de tema. */
  onAppAction?: PaletteHost['onAppAction'];
  onThemeChange?: (mode: ThemeMode) => void;
  /** Diagnóstico de arquitectura (T9): capas de layers.json, título y exportación del informe. */
  analysisLayers?: readonly string[] | null;
  reportTitle?: string;
  onExportReport?: (markdown: string) => void;
  /** Cada incremento restablece el visor (tarjetas, opciones de vista y encuadre). */
  resetSignal?: number;
}

export function RenderArea({
  project,
  model,
  selectedId,
  onSelect,
  canvasRef,
  areaRef,
  onLayoutLoadingChange,
  children,
  docKey,
  initialSidecar,
  onViewStateChange,
  highlightLine = null,
  onRelationSelect,
  onRename,
  onGoToCode,
  onCopyText,
  onAppAction,
  onThemeChange,
  analysisLayers = null,
  reportTitle,
  onExportReport,
  resetSignal,
}: Props): JSX.Element {
  const { t } = useLocalization();
  const labels = useMemo(() => viewerLabels(t), [t]);
  const paletteHost = useMemo<PaletteHost | undefined>(() => {
    if (!onAppAction || !onThemeChange) return undefined;
    return {
      themes: themeOptions.map((o) => ({ mode: o.mode, name: t(o.label) })),
      onAppAction,
      onTheme: (mode) => isThemeMode(mode) && onThemeChange(mode),
    };
  }, [onAppAction, onThemeChange, t]);
  if (!project && !model) {
    return (
      <main className="render-area">
        {children}
      </main>
    );
  }

  if (project && !project.puml && !model) {
    return (
      <main className="render-area">
        {children}
      </main>
    );
  }

  return (
    <main ref={areaRef} className="render-area has-canvas">
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
        highlightLine={highlightLine}
        {...(onRelationSelect ? { onRelationSelect } : {})}
        {...(onRename ? { onRename } : {})}
        {...(onGoToCode ? { onGoToCode } : {})}
        {...(onCopyText ? { onCopyText } : {})}
        {...(paletteHost ? { paletteHost } : {})}
        analysisLayers={analysisLayers}
        {...(reportTitle !== undefined ? { reportTitle } : {})}
        {...(onExportReport ? { onExportReport } : {})}
        {...(resetSignal !== undefined ? { resetSignal } : {})}
      />
      {children}
    </main>
  );
}
