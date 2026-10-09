import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Category, CategoryCounts, SidebarGroup } from '../../core/model';
import type { ProjectInfo } from '../../shared/ipc';
import { useI18n } from '../i18n/I18nProvider';

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 280;
const PAGE_SIZE = 200;

/** Letra por categoría. */
const LETTER: Record<Category, string> = {
  sealed: 'S',
  abstract: 'A',
  interface: 'I',
  enum: 'E',
  record: 'R',
  annotation: '@',
  class: 'C',
  external: 'X',
  undeclared: '?',
};

/** Orden canónico de los grupos (el mismo de GROUPS en classify.ts). */
const GROUP_ORDER: Category[] = [
  'sealed',
  'abstract',
  'interface',
  'enum',
  'record',
  'annotation',
  'class',
  'external',
  'undeclared',
];

/** Ordena las categorías en el orden canónico y descarta las desconocidas. */
function orderGroups(groups: SidebarGroup[]): SidebarGroup[] {
  return groups
    .filter((g) => GROUP_ORDER.includes(g.category))
    .sort((a, b) => GROUP_ORDER.indexOf(a.category) - GROUP_ORDER.indexOf(b.category));
}

interface Props {
  project: ProjectInfo | null;
  externalName?: string | null;
  width: number;
  onResize: (w: number) => void;
  groups?: SidebarGroup[];
  counts?: CategoryCounts | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function Sidebar({
  project,
  externalName,
  width,
  onResize,
  groups,
  counts,
  selectedId,
  onSelect,
}: Props): JSX.Element {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const dragging = useRef(false);

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<Category>>(() => new Set());
  const [visible, setVisible] = useState<Record<string, number>>({});

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

  const ordered = useMemo(() => orderGroups(groups ?? []), [groups]);

  const needle = query.trim().toLowerCase();

  /** Sin búsqueda, los 9 grupos (aunque estén vacíos); con búsqueda, solo los que tienen coincidencias. */
  const shown = useMemo(() => {
    if (needle.length === 0) return ordered;
    return ordered
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (i) => i.name.toLowerCase().includes(needle) || i.id.toLowerCase().includes(needle),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [ordered, needle]);

  const searching = needle.length > 0;

  // Al cambiar la búsqueda o el diagrama, se resetea la paginación y se hace scroll arriba.
  useEffect(() => {
    setVisible({});
    ref.current?.querySelector<HTMLElement>('.tree')?.scrollTo({ top: 0 });
  }, [needle, groups]);

  const toggleGroup = (category: Category) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const renderItem = (item: SidebarGroup['items'][number], category: Category): JSX.Element => {
    const selected = item.id === selectedId;
    return (
      <button
        key={item.id}
        type="button"
        className={`tree-item${selected ? ' selected' : ''}`}
        aria-current={selected ? 'true' : undefined}
        title={`${item.name} · ${item.packageName}`}
        onClick={() => onSelect?.(item.id)}
      >
        <span className={`cat-icon cat-${category}`} aria-hidden="true">
          {LETTER[category]}
        </span>
        <span className="tree-name">{item.name}</span>
        <span className="tree-pkg" title={item.packageName}>
          {item.packageName}
        </span>
      </button>
    );
  };

  const { puml } = project ?? { puml: null };
  const hasDiagram = counts !== null && counts !== undefined && ordered.length > 0;
  const fileLabel = puml?.originalFileName ?? externalName ?? null;

  return (
    <aside className="sidebar" ref={ref} style={{ width }}>
      <div className="sidebar-header">{t('sidebar.entities')}</div>

      {hasDiagram ? (
          <>
            {fileLabel && (
              <p className="sidebar-file sidebar-total" title={fileLabel}>
                {fileLabel}
              </p>
            )}
            <p className="sidebar-total">
              <strong>{counts?.totalInternal ?? 0}</strong> {t('sidebar.internalTypes')}
            </p>
            <input
              type="search"
              className="search-input"
              placeholder={t('sidebar.searchPlaceholder')}
              value={query}
              aria-label={t('sidebar.searchLabel')}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('');
              }}
            />
            <nav className="tree" aria-label={t('sidebar.treeLabel')}>
              {shown.length === 0 && <p className="sidebar-note muted">{t('sidebar.noMatches')}</p>}
              {shown.map((g) => {
                const isCollapsed = !searching && collapsed.has(g.category);
                const limit = visible[g.category] ?? PAGE_SIZE;
                const items = isCollapsed ? [] : g.items.slice(0, limit);
                const rest = isCollapsed ? 0 : g.items.length - items.length;
                return (
                  <div className="tree-group" key={g.category}>
                    <button
                      type="button"
                      className="tree-group-header"
                      aria-expanded={!isCollapsed}
                      onClick={() => toggleGroup(g.category)}
                    >
                      <span className={`cat-icon cat-${g.category}`} aria-hidden="true">
                        {LETTER[g.category]}
                      </span>
                      <span>{t(`category.${g.category}` as import('../i18n/catalog').MessageKey)}</span>
                      <span className="tree-count">{g.count}</span>
                    </button>
                    {items.map((i) => renderItem(i, g.category))}
                    {rest > 0 && (
                      <button
                        type="button"
                        className="tree-item tree-more"
                        onClick={() =>
                          setVisible((prev) => ({ ...prev, [g.category]: (prev[g.category] ?? PAGE_SIZE) + PAGE_SIZE }))
                        }
                      >
                        {t('sidebar.showMore', { count: rest })}
                      </button>
                    )}
                  </div>
                );
              })}
            </nav>
          </>
        ) : puml ? (
          <div className="sidebar-note">
            <p className="sidebar-file" title={puml.originalFileName}>
              {puml.originalFileName}
            </p>
            <p className="muted">
              {puml.lines} {t('sidebar.lines')} · {formatSize(puml.sizeBytes)}
            </p>
          </div>
        ) : fileLabel ? (
          <p className="sidebar-note muted">{fileLabel}: {t('sidebar.noEntities')}</p>
      ) : (
        <p className="sidebar-note muted">{t('sidebar.loadHint')}</p>
      )}

      <div
        className="resizer"
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        title={t('sidebar.resizeHint')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => onResize(DEFAULT_WIDTH)}
      />
    </aside>
  );
}
