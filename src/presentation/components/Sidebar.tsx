import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Category, DiagramModel } from '../../domain/diagram/model';
import { useLocalization } from '../localization/LocalizationProvider';
import type { MessageKey } from '../localization/translations';
import { CATEGORY_LETTER, entityTree, type EntityRow, type Grouping } from './entityGroups';
import { ChevronDownIcon, ChevronRightIcon, EyeIcon, EyePlusIcon } from './Icons';
import { MenuButton } from './MenuButton';

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
export const SIDEBAR_DEFAULT_WIDTH = 264;
const PAGE_SIZE = 200;
const GROUPING_KEY = 'autouml-entity-grouping';

interface Props {
  /** Documento abierto; null = sin diagrama (se muestra la pista para cargar uno). */
  model: DiagramModel | null;
  /** Nombre del archivo abierto (solo para la pista sin entidades). */
  fileLabel?: string | null;
  width: number;
  onResize: (w: number) => void;
  /** Tipos que no se dibujan (filtros, foco o hide del .puml). */
  outOfView?: ReadonlySet<string>;
  /** Tipos ocultos por el propio .puml → línea de la regla (null si no se sabe). */
  pumlHidden?: ReadonlyMap<string, number | null>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Ojo: quitar (false) o volver a poner (true) en la vista. */
  onSetVisible?: (id: string, visible: boolean) => void;
  /** "Ir al código" de una entidad oculta por hide. */
  onGoToLine?: (line: number) => void;
}

function readGrouping(): Grouping {
  try {
    return localStorage.getItem(GROUPING_KEY) === 'type' ? 'type' : 'package';
  } catch {
    return 'package';
  }
}

const NO_SET: ReadonlySet<string> = new Set();
const NO_MAP: ReadonlyMap<string, number | null> = new Map();

/**
 * Lista de entidades (T11): por paquete o por tipo, filtro, ojo al pasar el cursor y, al final, un bloque
 * plegable con lo que está fuera de la vista. Teclado: ↑/↓ recorren filas y cabeceras, Inicio/Fin saltan,
 * ←/→ pliegan y despliegan el grupo de la fila.
 */
export function Sidebar({
  model,
  fileLabel = null,
  width,
  onResize,
  outOfView = NO_SET,
  pumlHidden = NO_MAP,
  selectedId = null,
  onSelect,
  onSetVisible,
  onGoToLine,
}: Props): JSX.Element {
  const { t } = useLocalization();
  const ref = useRef<HTMLElement>(null);
  const dragging = useRef(false);
  const [query, setQuery] = useState('');
  const [grouping, setGroupingState] = useState<Grouping>(readGrouping);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(['\u0000out']));
  const [limits, setLimits] = useState<Record<string, number>>({});

  const setGrouping = (g: Grouping): void => {
    setGroupingState(g);
    try {
      localStorage.setItem(GROUPING_KEY, g);
    } catch {
      // Sin almacenamiento: dura la sesión.
    }
  };

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current || !ref.current) return;
      const left = ref.current.getBoundingClientRect().left;
      onResize(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(e.clientX - left))));
    },
    [onResize],
  );
  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const tree = useMemo(() => (model ? entityTree(model, grouping, outOfView, query) : null), [model, grouping, outOfView, query]);
  const searching = query.trim().length > 0;

  useEffect(() => {
    setLimits({});
  }, [query, model, grouping]);

  const toggle = (key: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** Navegación con flechas entre los elementos enfocables de la lista. */
  const onTreeKey = (e: KeyboardEvent<HTMLElement>): void => {
    const all = Array.from(ref.current?.querySelectorAll<HTMLElement>('.tree [data-nav]') ?? []);
    const current = document.activeElement as HTMLElement | null;
    const i = current ? all.indexOf(current) : -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      all[i < 0 ? 0 : Math.min(all.length - 1, Math.max(0, i + step))]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? all[0] : all[all.length - 1])?.focus();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && current) {
      const group = current.closest<HTMLElement>('[data-group]')?.dataset.group;
      if (group === undefined) return;
      const isCollapsed = collapsed.has(group);
      if ((e.key === 'ArrowLeft') !== isCollapsed) {
        e.preventDefault();
        toggle(group);
        // El foco vuelve a la cabecera del grupo (la fila puede desaparecer al plegar).
        requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-group="${CSS.escape(group)}"] .tree-group-header`)?.focus());
      }
    }
  };

  const groupTitle = (g: { prefix: string; leaf: string; category: Category | null }): JSX.Element => {
    if (g.category !== null) return <span className="tree-group-name">{t(`category.${g.category}` as MessageKey)}</span>;
    if (g.leaf === '') return <span className="tree-group-name muted">{t('sidebar.noPackage')}</span>;
    return (
      <span className="tree-group-name" title={g.prefix + g.leaf}>
        <span className="muted">{g.prefix}</span>
        <strong>{g.leaf}</strong>
      </span>
    );
  };

  const renderRow = (item: EntityRow, out: boolean): JSX.Element => {
    const selected = item.id === selectedId;
    const hideLine = out ? pumlHidden.get(item.id) : undefined;
    const byHide = out && pumlHidden.has(item.id);
    return (
      <div key={item.id} className={`tree-item${selected ? ' selected' : ''}${out ? ' out' : ''}`}>
        <button
          type="button"
          className="tree-main"
          data-nav=""
          aria-current={selected ? 'true' : undefined}
          title={`${item.name} · ${item.packageName}`}
          onClick={() => onSelect?.(item.id)}
        >
          <span className={`glyph g-${item.category}`} aria-hidden="true">{CATEGORY_LETTER[item.category]}</span>
          <span className="tree-name">{item.name}</span>
          {byHide && <span className="tree-src">{hideLine != null ? t('sidebar.hideLine', { line: hideLine }) : 'hide'}</span>}
        </button>
        {byHide ? (
          hideLine != null && onGoToLine ? (
            <button type="button" className="tree-act" onClick={() => onGoToLine(hideLine)} aria-label={t('sidebar.goToHide', { name: item.name })}>
              {t('sidebar.goToCode')}
            </button>
          ) : null
        ) : onSetVisible ? (
          <button
            type="button"
            className="tree-eye"
            aria-label={t(out ? 'sidebar.showInView' : 'sidebar.hideFromView', { name: item.name })}
            title={t(out ? 'sidebar.showInViewShort' : 'sidebar.hideFromViewShort')}
            onClick={() => onSetVisible(item.id, out)}
          >
            {out ? <EyePlusIcon /> : <EyeIcon />}
          </button>
        ) : null}
      </div>
    );
  };

  const renderGroup = (key: string, title: JSX.Element, items: EntityRow[], out: boolean, extraClass = ''): JSX.Element => {
    const isCollapsed = !searching && collapsed.has(key);
    const limit = limits[key] ?? PAGE_SIZE;
    const shown = isCollapsed ? [] : items.slice(0, limit);
    const rest = isCollapsed ? 0 : items.length - shown.length;
    return (
      <div className={`tree-group ${extraClass}`.trim()} key={key} data-group={key}>
        <button type="button" className="tree-group-header" data-nav="" aria-expanded={!isCollapsed} onClick={() => toggle(key)}>
          {isCollapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          {title}
          <span className="tree-count">{items.length}</span>
        </button>
        {shown.map((i) => renderRow(i, out))}
        {rest > 0 && (
          <button
            type="button"
            className="tree-more"
            data-nav=""
            onClick={() => setLimits((prev) => ({ ...prev, [key]: limit + PAGE_SIZE }))}
          >
            {t('sidebar.showMore', { count: rest })}
          </button>
        )}
      </div>
    );
  };

  const hasEntities = model !== null && model.types.length > 0;

  return (
    <aside className="sidebar" ref={ref} style={{ width }} aria-label={t('sidebar.entities')}>
      <div className="panel-head">
        <span className="panel-title">{t('sidebar.entities')}</span>
        {hasEntities && (
          <MenuButton
            className="grouping-menu"
            label={grouping === 'package' ? t('sidebar.byPackage') : t('sidebar.byType')}
            ariaLabel={t('sidebar.groupingAria', { current: grouping === 'package' ? t('sidebar.byPackage') : t('sidebar.byType') })}
            alignEnd
            items={[
              { id: 'package', label: t('sidebar.byPackage'), checked: grouping === 'package', run: () => setGrouping('package') },
              { id: 'type', label: t('sidebar.byType'), checked: grouping === 'type', run: () => setGrouping('type') },
            ]}
          />
        )}
      </div>

      {hasEntities && tree ? (
        <>
          <label className="search-field">
            <span className="visually-hidden">{t('sidebar.searchLabel')}</span>
            <input
              type="search"
              placeholder={t('sidebar.searchPlaceholder')}
              value={query}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('');
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  ref.current?.querySelector<HTMLElement>('.tree [data-nav]')?.focus();
                }
              }}
            />
          </label>
          <nav className="tree" aria-label={t('sidebar.treeLabel')} onKeyDown={onTreeKey}>
            {tree.groups.length === 0 && tree.outOfView.length === 0 && <p className="sidebar-note muted">{t('sidebar.noMatches')}</p>}
            {tree.groups.map((g) => renderGroup(g.key, groupTitle(g), g.items, false))}
            {tree.outOfView.length > 0 &&
              renderGroup('\u0000out', <span className="tree-group-name muted">{t('sidebar.outOfView')}</span>, tree.outOfView, true, 'out-block')}
          </nav>
        </>
      ) : (
        <p className="sidebar-note muted">{fileLabel ? `${fileLabel}: ${t('sidebar.noEntities')}` : t('sidebar.loadHint')}</p>
      )}

      <div
        className="resizer"
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-label={t('sidebar.resizeHint')}
        tabIndex={0}
        title={t('sidebar.resizeHint')}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          onResize(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + (e.key === 'ArrowRight' ? 16 : -16))));
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => onResize(SIDEBAR_DEFAULT_WIDTH)}
      />
    </aside>
  );
}
