import type { JSX, ReactNode } from 'react';
import { ExportIcon, FitIcon, LoadIcon, MoonIcon, ReloadIcon, SidebarIcon, SunIcon, SystemIcon, ZoomInIcon, ZoomOutIcon } from './Icons';
import type { ThemeMode } from './useTheme';

interface Props {
  projectName: string | null;
  canLoad: boolean;
  canReload: boolean;
  sidebarVisible: boolean;
  themeMode: ThemeMode;
  onCycleTheme: () => void;
  onLoad: () => void;
  onReload: () => void;
  canView: boolean;
  onToggleSidebar: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onExport: () => void;
}

interface ToolProps {
  label: string;
  shortcut: string;
  icon: ReactNode;
  disabled: boolean;
  onClick?: () => void;
}

function ToolButton({ label, shortcut, icon, disabled, onClick }: ToolProps): JSX.Element {
  const text = `${label} (${shortcut})`;
  return (
    <button
      type="button"
      className="tool-btn"
      title={text}
      aria-label={text}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

export function Header({
  projectName,
  canLoad,
  canReload,
  sidebarVisible,
  themeMode,
  onCycleTheme,
  onLoad,
  onReload,
  canView,
  onToggleSidebar,
  onZoomIn,
  onZoomOut,
  onFit,
  onExport,
}: Props): JSX.Element {
  const themeIcon = themeMode === 'light' ? <SunIcon /> : themeMode === 'dark' ? <MoonIcon /> : <SystemIcon />;
  const themeLabel = themeMode === 'light' ? 'Tema claro' : themeMode === 'dark' ? 'Tema oscuro' : 'Tema del sistema';
  return (
    <header className="header">
      <button
        type="button"
        className={`tool-btn${sidebarVisible ? ' active' : ''}`}
        title={`${sidebarVisible ? 'Ocultar' : 'Mostrar'} sidebar (Ctrl+B)`}
        aria-label="Mostrar u ocultar sidebar (Ctrl+B)"
        aria-pressed={sidebarVisible}
        disabled={projectName === null}
        onClick={onToggleSidebar}
      >
        <SidebarIcon />
      </button>

      <div className="header-title" title={projectName ?? undefined}>
        <span className="app-name">AutoUML</span>
        <span className="sep">/</span>
        <span className={projectName ? 'project-title' : 'project-title muted'}>{projectName ?? 'Sin proyecto'}</span>
      </div>

      <div className="toolbar" role="toolbar" aria-label="Herramientas del diagrama">
        <ToolButton label="Cargar PUML" shortcut="Ctrl+O" icon={<LoadIcon />} disabled={!canLoad} onClick={onLoad} />
        <ToolButton label="Recargar" shortcut="Ctrl+R" icon={<ReloadIcon />} disabled={!canReload} onClick={onReload} />
        <span className="toolbar-sep" aria-hidden="true" />
        <ToolButton label="Zoom +" shortcut="Ctrl+=" icon={<ZoomInIcon />} disabled={!canView} onClick={onZoomIn} />
        <ToolButton label="Zoom −" shortcut="Ctrl+-" icon={<ZoomOutIcon />} disabled={!canView} onClick={onZoomOut} />
        <ToolButton label="Ajustar a pantalla" shortcut="Ctrl+0" icon={<FitIcon />} disabled={!canView} onClick={onFit} />
        <ToolButton label="Exportar PNG" shortcut="Ctrl+E" icon={<ExportIcon />} disabled={!canView} onClick={onExport} />
        <span className="toolbar-sep" aria-hidden="true" />
        <button
          type="button"
          className="tool-btn"
          title={`${themeLabel}: clic para cambiar (Sistema → Claro → Oscuro)`}
          aria-label={`${themeLabel}: clic para cambiar de tema`}
          onClick={onCycleTheme}
        >
          {themeIcon}
        </button>
      </div>
    </header>
  );
}
