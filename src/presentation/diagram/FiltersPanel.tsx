// src/presentation/diagram/FiltersPanel.tsx — panel de filtros semánticos del visor (T8).
// Botón de la barra del visor que despliega el panel (disclosure no modal). Abrir y cerrar es estado LOCAL:
// no re-renderiza PumlViewer ni el lienzo; solo un cambio de filtro sube por onChange.
import { useEffect, useId, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { RelType, Visibility } from '../../domain/diagram/model';
import { activeFilterCount, type DiagramFilters } from './graph/filters';
import { fill, type ViewerLabels } from './labels';

const REL_TYPES: RelType[] = ['EXTENDS', 'IMPLEMENTS', 'ASSOCIATION', 'DEPENDENCY', 'COMPOSITION', 'AGGREGATION'];
const DEFAULT_PACKAGE = '(default package)';

/** Copia de `list` con `item` presente (`on`) o ausente; la misma lista si ya estaba así. */
export function withListItem<T>(list: readonly T[] | undefined, item: T, on: boolean): T[] {
  const cur = list ?? [];
  const has = cur.includes(item);
  if (on === has) return cur as T[];
  return on ? [...cur, item] : cur.filter((x) => x !== item);
}

interface Props {
  filters: DiagramFilters;
  /** Paquetes del documento (nombres reales). */
  packages: readonly string[];
  labels: ViewerLabels;
  onChange: (next: DiagramFilters) => void;
  /** Solo para tests y vistas previas: empieza abierto. */
  defaultOpen?: boolean;
}

export function FiltersPanel({ filters, packages, labels, onChange, defaultOpen = false }: Props): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const count = activeFilterCount(filters);

  // Clic fuera: se cierra sin robar el foco (el usuario ya está en otro sitio).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (wrapRef.current && e.target instanceof Node && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Esc dentro del panel: cierra y devuelve el foco al botón; no llega a los atajos del visor.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Escape' || !open) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    buttonRef.current?.focus();
  };

  const set = (patch: Partial<DiagramFilters>): void => onChange({ ...filters, ...patch });
  const visibility: Array<[Visibility, string]> = [
    ['-', labels.filtersVisAll],
    ['~', labels.filtersVisPackage],
    ['#', labels.filtersVisProtected],
    ['+', labels.filtersVisPublic],
  ];
  const hiddenPkgs = filters.hiddenPackages ?? [];
  const hiddenTypes = filters.hiddenTypes?.length ?? 0;

  return (
    <div ref={wrapRef} className="puml-viewer-filters" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className={count > 0 ? 'puml-viewer-reset is-active' : 'puml-viewer-reset'}
        aria-expanded={open}
        aria-controls={panelId}
        title={labels.filtersTitle}
        onClick={() => setOpen((v) => !v)}
      >
        {count > 0 ? fill(labels.filtersActive, { n: count }) : labels.filters}
      </button>
      {open ? (
        <div id={panelId} className="filters-panel" role="group" aria-label={labels.filtersPanelAria}>
          <fieldset>
            <legend>{labels.filtersRelations}</legend>
            {REL_TYPES.map((r) => (
              <label key={r}>
                <input
                  type="checkbox"
                  checked={!(filters.hiddenRelTypes ?? []).includes(r)}
                  onChange={(e) => set({ hiddenRelTypes: withListItem(filters.hiddenRelTypes, r, !e.target.checked) })}
                />
                {labels.relTypes[r]}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>{labels.filtersMembers}</legend>
            <label className="filters-panel-select">
              {labels.filtersMinVisibility}
              <select
                value={filters.minVisibility ?? '-'}
                onChange={(e) => set({ minVisibility: e.target.value as Visibility })}
              >
                {visibility.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
              </select>
            </label>
            <label>
              <input type="checkbox" checked={filters.hideAccessors === true} onChange={(e) => set({ hideAccessors: e.target.checked })} />
              {labels.filtersAccessors}
            </label>
            <label>
              <input type="checkbox" checked={filters.hideConstructors === true} onChange={(e) => set({ hideConstructors: e.target.checked })} />
              {labels.filtersConstructors}
            </label>
            <p className="filters-panel-hint">{labels.filtersRelayoutHint}</p>
          </fieldset>
          <fieldset>
            <legend>{labels.filtersClasses}</legend>
            <label>
              <input type="checkbox" checked={filters.hideExternal === true} onChange={(e) => set({ hideExternal: e.target.checked })} />
              {labels.filtersExternal}
            </label>
            <label>
              <input type="checkbox" checked={filters.hideUndeclared === true} onChange={(e) => set({ hideUndeclared: e.target.checked })} />
              {labels.filtersUndeclared}
            </label>
            {hiddenTypes > 0 ? (
              <p className="filters-panel-row">
                <span>{fill(labels.filtersHiddenTypes, { n: hiddenTypes })}</span>
                <button type="button" className="filters-panel-link" onClick={() => set({ hiddenTypes: [] })}>
                  {labels.filtersShowTypes}
                </button>
              </p>
            ) : null}
          </fieldset>
          {packages.length > 0 ? (
            <fieldset>
              <legend>{labels.filtersPackages}</legend>
              <p className="filters-panel-row">
                <button type="button" className="filters-panel-link" onClick={() => set({ hiddenPackages: [] })}>
                  {labels.filtersAllPackages}
                </button>
                <button type="button" className="filters-panel-link" onClick={() => set({ hiddenPackages: [...packages] })}>
                  {labels.filtersNoPackages}
                </button>
              </p>
              <div className="filters-panel-packages">
                {packages.map((p) => (
                  <label key={p} title={p}>
                    <input
                      type="checkbox"
                      checked={!hiddenPkgs.includes(p)}
                      onChange={(e) => set({ hiddenPackages: withListItem(filters.hiddenPackages, p, !e.target.checked) })}
                    />
                    <span className="filters-panel-pkg">{p === DEFAULT_PACKAGE ? labels.noPackage : p}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="filters-panel-actions">
            <button type="button" className="puml-viewer-reset" onClick={() => onChange({})} disabled={count === 0}>
              {labels.filtersClear}
            </button>
            <button
              type="button"
              className="puml-viewer-reset"
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              {labels.filtersClose}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
