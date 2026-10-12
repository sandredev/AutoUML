import type { JSX } from 'react';
import type { MenuAction, MenuState } from '../../application/ports/ipc';
import { keysOf } from '../../application/shortcuts';
import { AppMenuBar, type RecentItem } from './AppMenuBar';
import { CodeIcon, InspectorIcon, ReloadIcon, SidebarIcon } from './Icons';
import { useLocalization } from '../localization/LocalizationProvider';
import { withShortcut } from '../localization/translations';

interface Props {
  /** Nombre del documento abierto (con extensión); null en Inicio. */
  docName: string | null;
  dirty: boolean;
  sidebarVisible: boolean;
  editorVisible: boolean;
  inspectorVisible: boolean;
  /** Hay documento: los paneles se pueden mostrar. */
  hasDocument: boolean;
  canEdit: boolean;
  canReload: boolean;
  onToggleSidebar: () => void;
  onToggleEditor: () => void;
  onToggleInspector: () => void;
  onReload: () => void;
  menuState: MenuState;
  onMenuAction: (action: MenuAction) => void;
  recents: readonly RecentItem[];
  onOpenRecent: (id: string) => void;
}

/**
 * Barra de título única (T11): logo, menús, documento en el centro y paneles a la derecha. Los controles de
 * ventana del sistema se superponen a la derecha (titleBarOverlay); la barra deja su hueco.
 */
export function TitleBar(p: Props): JSX.Element {
  const { t } = useLocalization();
  const panel = (label: string, shortcut: string | null, pressed: boolean, disabled: boolean, onClick: () => void, icon: JSX.Element) => {
    const text = shortcut ? withShortcut(label, shortcut) : label;
    return (
      <button type="button" className={pressed ? 'tool-btn active' : 'tool-btn'} title={text} aria-label={text} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
        {icon}
      </button>
    );
  };
  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <img className="app-logo" src="./favicon.png" alt="" aria-hidden="true" />
        <span className="app-name">AutoUML</span>
      </div>
      <AppMenuBar
        state={p.menuState}
        onAction={p.onMenuAction}
        recents={p.recents}
        onOpenRecent={p.onOpenRecent}
        inspectorVisible={p.inspectorVisible}
      />
      <div className="titlebar-doc" title={p.docName ?? undefined}>
        {p.docName && (
          <>
            <span className="titlebar-doc-name">{p.docName}</span>
            {p.dirty && <span className="titlebar-doc-state">· {t('title.unsaved')}</span>}
          </>
        )}
      </div>
      <div className="titlebar-tools" role="toolbar" aria-label={t('title.panels')}>
        {panel(t('title.entities'), keysOf('toggleSidebar'), p.sidebarVisible && p.hasDocument, !p.hasDocument, p.onToggleSidebar, <SidebarIcon />)}
        {panel(t('title.code'), keysOf('toggleEditor'), p.editorVisible && p.canEdit, !p.canEdit, p.onToggleEditor, <CodeIcon />)}
        {panel(t('title.inspector'), null, p.inspectorVisible && p.hasDocument, !p.hasDocument, p.onToggleInspector, <InspectorIcon />)}
        <span className="toolbar-sep" aria-hidden="true" />
        <button
          type="button"
          className="tool-btn"
          title={withShortcut(t('header.reload'), keysOf('reload'))}
          aria-label={withShortcut(t('header.reload'), keysOf('reload'))}
          disabled={!p.canReload}
          onClick={p.onReload}
        >
          <ReloadIcon />
        </button>
      </div>
    </header>
  );
}
