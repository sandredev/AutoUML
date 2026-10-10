import { useEffect, useRef, useState, type JSX } from 'react';
import type { MenuAction, MenuCommand, MenuState } from '../../application/ports/ipc';
import { useLocalization } from '../localization/LocalizationProvider';

interface Props {
  state: MenuState;
  onAction: (action: MenuAction) => void;
}

type Entry =
  | { kind: 'separator' }
  | {
      kind: 'item';
      label: string;
      run: () => void;
      enabled?: boolean;
      shortcut?: string;
      /** Si está definido, es un elemento tipo checkbox y este es su estado. */
      checked?: boolean;
    };

const SEPARATOR: Entry = { kind: 'separator' };

export function AppMenuBar({ state, onAction }: Props): JSX.Element {
  const { t } = useLocalization();
  const [open, setOpen] = useState<number | null>(null);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (open === null) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', () => setOpen(null), { once: true });
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const action = (a: MenuAction) => () => onAction(a);
  const command = (c: MenuCommand) => () => window.autouml.runMenuCommand(c);
  const anyContent = state.projectOpen || state.hasPuml;

  const menus: { title: string; entries: Entry[]; onSelect?: () => void }[] = [
    {
      title: t('menu.file'),
      entries: [
        { kind: 'item', label: t('menu.newProject'), shortcut: 'Ctrl+N', run: action('new-project') },
        { kind: 'item', label: t('menu.openProject'), shortcut: 'Ctrl+Shift+O', run: action('open-project') },
        SEPARATOR,
        { kind: 'item', label: t('menu.loadPuml'), shortcut: 'Ctrl+O', enabled: state.projectOpen, run: action('load-puml') },
        { kind: 'item', label: t('menu.reload'), shortcut: 'Ctrl+R', enabled: state.hasPuml, run: action('reload-puml') },
        { kind: 'item', label: t('menu.exportPng'), shortcut: 'Ctrl+E', enabled: state.hasPuml, run: action('export') },
        { kind: 'item', label: t('menu.exportSvg'), shortcut: 'Ctrl+Shift+E', enabled: state.hasPuml, run: action('export-svg') },
        { kind: 'item', label: t('menu.exportPdf'), shortcut: 'Ctrl+Shift+P', enabled: state.hasPuml, run: action('export-pdf') },
        { kind: 'item', label: t('menu.copyPng'), shortcut: 'Ctrl+Shift+C', enabled: state.hasPuml, run: action('copy-png') },
        SEPARATOR,
        { kind: 'item', label: t('menu.quit'), run: command('quit') },
      ],
    },
    {
      title: t('menu.edit'),
      entries: [
        { kind: 'item', label: t('menu.replacePuml'), enabled: state.projectOpen, run: action('replace-puml') },
        { kind: 'item', label: t('menu.copyProjectName'), enabled: state.projectOpen, run: command('copy-project-name') },
        SEPARATOR,
        { kind: 'item', label: t('menu.copy'), run: command('copy') },
        { kind: 'item', label: t('menu.selectAll'), run: command('select-all') },
      ],
    },
    {
      title: t('menu.view'),
      entries: [
        { kind: 'item', label: t('menu.zoomIn'), shortcut: 'Ctrl+=', enabled: state.hasPuml, run: action('zoom-in') },
        { kind: 'item', label: t('menu.zoomOut'), shortcut: 'Ctrl+-', enabled: state.hasPuml, run: action('zoom-out') },
        { kind: 'item', label: t('menu.fit'), shortcut: 'Ctrl+0', enabled: state.hasPuml, run: action('fit') },
        SEPARATOR,
        {
          kind: 'item',
          label: t('menu.showSidebar'),
          shortcut: 'Ctrl+B',
          checked: state.sidebarVisible,
          enabled: anyContent,
          run: action('toggle-sidebar'),
        },
        ...(import.meta.env.DEV
          ? [SEPARATOR, { kind: 'item', label: t('menu.devTools'), run: command('dev-tools') } satisfies Entry]
          : []),
      ],
    },
    { title: t('menu.configuration'), entries: [], onSelect: action('settings-more') },
    { title: t('menu.help'), entries: [{ kind: 'item', label: t('menu.about'), run: command('about') }] },
  ];

  return (
    <nav className="menubar" ref={rootRef} aria-label="Menu">
      {menus.map((menu, index) => (
        <div key={index} className="menubar-group">
          <button
            type="button"
            className={open === index ? 'menubar-btn open' : 'menubar-btn'}
            aria-haspopup={menu.entries.length > 0 ? 'menu' : undefined}
            aria-expanded={menu.entries.length > 0 ? open === index : undefined}
            onClick={() => {
              if (menu.onSelect) {
                setOpen(null);
                menu.onSelect();
              } else {
                setOpen(open === index ? null : index);
              }
            }}
            onPointerEnter={() => open !== null && setOpen(index)}
          >
            {menu.title}
          </button>
          {open === index && menu.entries.length > 0 && (
            <div className="menu-popup" role="menu">
              {menu.entries.map((entry, i) => {
                if (entry.kind === 'separator') return <div key={i} className="menu-sep" role="separator" />;
                const role = entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox';
                return (
                  <button
                    key={i}
                    type="button"
                    className="menu-item"
                    role={role}
                    aria-checked={entry.checked}
                    disabled={entry.enabled === false}
                    onClick={() => {
                      setOpen(null);
                      entry.run();
                    }}
                  >
                    <span className="menu-check" aria-hidden="true">
                      {entry.checked ? '✓' : ''}
                    </span>
                    <span className="menu-label">{entry.label}</span>
                    {entry.shortcut && <span className="menu-shortcut">{entry.shortcut}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
