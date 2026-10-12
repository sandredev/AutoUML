import { useEffect, useRef, useState, type JSX } from 'react';
import type { MenuAction, MenuCommand, MenuState } from '../../application/ports/ipc';
import { keysOf } from '../../application/shortcuts';
import { useLocalization } from '../localization/LocalizationProvider';

/** Entrada de Archivo › Recientes (T11). */
export interface RecentItem {
  id: string;
  name: string;
  path: string;
}

interface Props {
  state: MenuState;
  onAction: (action: MenuAction) => void;
  /** Diagramas recientes (los primeros) para Archivo › Recientes. */
  recents?: readonly RecentItem[];
  onOpenRecent?: (id: string) => void;
  /** Inspector visible (casilla de Ver). */
  inspectorVisible?: boolean;
}

type Entry =
  | { kind: 'separator' }
  /** Título de sección dentro del menú (no seleccionable). */
  | { kind: 'heading'; label: string }
  | {
      kind: 'item';
      label: string;
      run: () => void;
      enabled?: boolean;
      shortcut?: string;
      /** Texto secundario en el title (p. ej. la ruta de un reciente). */
      hint?: string;
      /** Si está definido, es un elemento tipo checkbox y este es su estado. */
      checked?: boolean;
    };

const SEPARATOR: Entry = { kind: 'separator' };

export function AppMenuBar({ state, onAction, recents = [], onOpenRecent, inspectorVisible = false }: Props): JSX.Element {
  const { t } = useLocalization();
  const [open, setOpen] = useState<number | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const menusRef = useRef<{ entries: Entry[] }[]>([]);

  useEffect(() => {
    if (open === null) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
    };
    // Teclado (T11): ↑/↓ recorren el menú abierto, ←/→ pasan al menú vecino, Esc cierra y vuelve al título.
    const items = (): HTMLButtonElement[] =>
      Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('.menu-popup .menu-item:not(:disabled)') ?? []);
    const titles = (): HTMLButtonElement[] => Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('.menubar-btn') ?? []);
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        titles()[open]?.focus();
        setOpen(null);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const list = items();
        if (list.length === 0) return;
        e.preventDefault();
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        list[i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length]?.focus();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const count = titles().length;
        let next = open;
        // Configuración no tiene menú: se salta.
        do next = (next + (e.key === 'ArrowRight' ? 1 : -1) + count) % count;
        while (next !== open && menusRef.current[next]?.entries.length === 0);
        setOpen(next);
      }
    };
    requestAnimationFrame(() => items()[0]?.focus());
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
        { kind: 'item', label: t('menu.newProject'), shortcut: keysOf('newProject'), run: action('new-project') },
        { kind: 'item', label: t('menu.openFile'), run: action('open-file') },
        { kind: 'item', label: t('menu.openProject'), shortcut: keysOf('openProject'), run: action('open-project') },
        { kind: 'item', label: t('menu.home'), run: action('go-home') },
        ...(recents.length > 0
          ? [
              SEPARATOR,
              { kind: 'heading', label: t('menu.recents') } satisfies Entry,
              ...recents.slice(0, 5).map((r): Entry => ({ kind: 'item', label: r.name, hint: r.path, run: () => onOpenRecent?.(r.id) })),
            ]
          : []),
        SEPARATOR,
        { kind: 'item', label: t('menu.loadPuml'), shortcut: keysOf('loadPuml'), enabled: state.projectOpen, run: action('load-puml') },
        { kind: 'item', label: t('menu.reload'), shortcut: keysOf('reload'), enabled: state.hasPuml, run: action('reload-puml') },
        { kind: 'item', label: t('menu.save'), shortcut: keysOf('save'), enabled: state.hasPuml && state.dirty, run: action('save') },
        { kind: 'item', label: t('menu.saveAs'), enabled: state.hasPuml, run: action('save-as') },
        SEPARATOR,
        { kind: 'item', label: t('menu.exportPng'), enabled: state.hasPuml, run: action('export') },
        { kind: 'item', label: t('menu.exportSvg'), shortcut: keysOf('exportSvg'), enabled: state.hasPuml, run: action('export-svg') },
        { kind: 'item', label: t('menu.exportPdf'), shortcut: keysOf('exportPdf'), enabled: state.hasPuml, run: action('export-pdf') },
        { kind: 'item', label: t('menu.copyPng'), shortcut: keysOf('copyPng'), enabled: state.hasPuml, run: action('copy-png') },
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
        { kind: 'item', label: t('menu.zoomIn'), shortcut: keysOf('zoomIn'), enabled: state.hasPuml, run: action('zoom-in') },
        { kind: 'item', label: t('menu.zoomOut'), shortcut: keysOf('zoomOut'), enabled: state.hasPuml, run: action('zoom-out') },
        { kind: 'item', label: t('menu.fit'), shortcut: keysOf('fit'), enabled: state.hasPuml, run: action('fit') },
        SEPARATOR,
        {
          kind: 'item',
          label: t('menu.showSidebar'),
          shortcut: keysOf('toggleSidebar'),
          checked: state.sidebarVisible,
          enabled: anyContent,
          run: action('toggle-sidebar'),
        },
        {
          kind: 'item',
          label: t('menu.showEditor'),
          shortcut: keysOf('toggleEditor'),
          checked: state.editorVisible,
          enabled: state.hasPuml,
          run: action('toggle-editor'),
        },
        {
          kind: 'item',
          label: t('menu.showInspector'),
          checked: inspectorVisible,
          enabled: anyContent,
          run: action('toggle-inspector'),
        },
        ...(import.meta.env.DEV
          ? [SEPARATOR, { kind: 'item', label: t('menu.devTools'), run: command('dev-tools') } satisfies Entry]
          : []),
      ],
    },
    { title: t('menu.configuration'), entries: [], onSelect: action('settings-more') },
    { title: t('menu.help'), entries: [{ kind: 'item', label: t('menu.about'), run: action('show-about') }] },
  ];

  menusRef.current = menus;

  return (
    <nav className="menubar" ref={rootRef} aria-label={t('menu.aria')}>
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
                if (entry.kind === 'heading') return <div key={i} className="menu-heading" role="presentation">{entry.label}</div>;
                const role = entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox';
                return (
                  <button
                    key={i}
                    type="button"
                    className="menu-item"
                    role={role}
                    aria-checked={entry.checked}
                    disabled={entry.enabled === false}
                    title={entry.hint}
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
