
import type { JSX, ReactNode } from 'react';
import { ExportIcon, FitIcon, LoadIcon, ReloadIcon, SidebarIcon, ZoomInIcon, ZoomOutIcon } from './Icons';
import { useI18n } from '../i18n/I18nProvider';
import { withShortcut } from '../i18n/catalog';
import './settings.css';

interface Props {
  projectName: string | null;
  canLoad: boolean;
  canReload: boolean;
  sidebarVisible: boolean;
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
  const text = withShortcut(label, shortcut);
  return (
    <button type="button" className="tool-btn" title={text} aria-label={text} disabled={disabled} onClick={onClick}>
      {icon}
    </button>
  );
}

export function Header({
  projectName,
  canLoad,
  canReload,
  sidebarVisible,
  onLoad,
  onReload,
  canView,
  onToggleSidebar,
  onZoomIn,
  onZoomOut,
  onFit,
  onExport,
}: Props): JSX.Element {
  const { t } = useI18n();
  const sidebarTitle = withShortcut(sidebarVisible ? t('header.sidebarHide') : t('header.sidebarShow'), 'Ctrl+B');
  return (
    <header className="header">
      <button
        type="button"
        className={sidebarVisible ? 'tool-btn active' : 'tool-btn'}
        title={sidebarTitle}
        aria-label={withShortcut(t('header.sidebarToggle'), 'Ctrl+B')}
        aria-pressed={sidebarVisible}
        disabled={projectName === null}
        onClick={onToggleSidebar}
      >
        <SidebarIcon />
      </button>

      <div className="header-title" title={projectName ?? undefined}>
        <span className="app-name">AutoUML</span>
        <span className="sep">/</span>
        <span className={projectName ? 'project-title' : 'project-title muted'}>{projectName ?? t('app.noProject')}</span>
      </div>

      <div className="toolbar" role="toolbar" aria-label={t('header.toolbar')}>
        <ToolButton label={t('header.load')} shortcut="Ctrl+O" icon={<LoadIcon />} disabled={!canLoad} onClick={onLoad} />
        <ToolButton label={t('header.reload')} shortcut="Ctrl+R" icon={<ReloadIcon />} disabled={!canReload} onClick={onReload} />
        <span className="toolbar-sep" aria-hidden="true" />
        <ToolButton label={t('header.zoomIn')} shortcut="Ctrl+=" icon={<ZoomInIcon />} disabled={!canView} onClick={onZoomIn} />
        <ToolButton label={t('header.zoomOut')} shortcut="Ctrl+-" icon={<ZoomOutIcon />} disabled={!canView} onClick={onZoomOut} />
        <ToolButton label={t('header.fit')} shortcut="Ctrl+0" icon={<FitIcon />} disabled={!canView} onClick={onFit} />
        <ToolButton label={t('header.export')} shortcut="Ctrl+E" icon={<ExportIcon />} disabled={!canView} onClick={onExport} />
      </div>
    </header>
  );
}
