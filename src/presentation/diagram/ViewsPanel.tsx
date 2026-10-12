// src/presentation/diagram/ViewsPanel.tsx — vistas guardadas como diapositivas (T10).
// Disclosure no modal como FiltersPanel: abrir/cerrar es estado local; guardar/aplicar/borrar suben por callbacks.
import { useEffect, useId, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { DeckView } from './presentation/views';
import { fill, type ViewsLabels } from './labels';

export interface SaveViewOptions {
  title: string;
  includeFilters: boolean;
  includeFocus: boolean;
  includeCollapsed: boolean;
}

interface Props {
  views: readonly DeckView[];
  labels: ViewsLabels;
  /** Hay filtros activos / clase en foco / paquetes plegados: habilita su casilla. */
  hasFilters: boolean;
  hasFocus: boolean;
  hasCollapsed: boolean;
  onSave: (opts: SaveViewOptions) => void;
  onApply: (index: number) => void;
  onRemove: (index: number) => void;
  onRename: (index: number, title: string) => void;
  onMove: (from: number, to: number) => void;
  onPresent: () => void;
  /** Solo para tests y vistas previas: empieza abierto. */
  defaultOpen?: boolean;
}

export function ViewsPanel({ views, labels, hasFilters, hasFocus, hasCollapsed, onSave, onApply, onRemove, onRename, onMove, onPresent, defaultOpen = false }: Props): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const [title, setTitle] = useState('');
  const [inclFilters, setInclFilters] = useState(true);
  const [inclFocus, setInclFocus] = useState(true);
  const [inclCollapsed, setInclCollapsed] = useState(true);
  const [renaming, setRenaming] = useState<number | null>(null);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (wrapRef.current && e.target instanceof Node && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Escape' || !open) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    buttonRef.current?.focus();
  };

  const save = (): void => {
    const trimmed = title.trim();
    onSave({
      title: trimmed || fill(labels.defaultTitle, { n: views.length + 1 }),
      includeFilters: hasFilters && inclFilters,
      includeFocus: hasFocus && inclFocus,
      includeCollapsed: hasCollapsed && inclCollapsed,
    });
    setTitle('');
  };

  return (
    <div ref={wrapRef} className="puml-viewer-filters" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className={views.length > 0 ? 'puml-viewer-reset is-active' : 'puml-viewer-reset'}
        aria-expanded={open}
        aria-controls={panelId}
        title={labels.toggleTitle}
        onClick={() => setOpen((v) => !v)}
      >
        {views.length > 0 ? `${labels.toggle} (${views.length})` : labels.toggle}
      </button>
      {open ? (
        <div id={panelId} className="filters-panel align-start" role="group" aria-label={labels.panelAria}>
          <form
            className="views-panel-form"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <fieldset>
              <legend>{labels.saveHeading}</legend>
              <label className="views-panel-title">
                {labels.titleLabel}
                <input
                  type="text"
                  value={title}
                  maxLength={200}
                  placeholder={fill(labels.defaultTitle, { n: views.length + 1 })}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                <input type="checkbox" checked={hasFilters && inclFilters} disabled={!hasFilters} onChange={(e) => setInclFilters(e.target.checked)} />
                {labels.includeFilters}
              </label>
              <label>
                <input type="checkbox" checked={hasFocus && inclFocus} disabled={!hasFocus} onChange={(e) => setInclFocus(e.target.checked)} />
                {labels.includeFocus}
              </label>
              <label>
                <input type="checkbox" checked={hasCollapsed && inclCollapsed} disabled={!hasCollapsed} onChange={(e) => setInclCollapsed(e.target.checked)} />
                {labels.includeCollapsed}
              </label>
            </fieldset>
            <button type="submit" className="puml-viewer-reset">{labels.save}</button>
          </form>
          <fieldset>
            <legend>{labels.listHeading}</legend>
            <button type="button" className="puml-viewer-reset" title={labels.presentTitle} disabled={views.length === 0} onClick={onPresent}>
              {labels.present}
            </button>
            {views.length === 0 ? (
              <p className="filters-panel-hint">{labels.empty}</p>
            ) : (
              <ol className="views-panel-list">
                {views.map((v, i) => (
                  <li key={i}>
                    {renaming === i ? (
                      <input
                        className="views-panel-rename"
                        type="text"
                        autoFocus
                        maxLength={200}
                        defaultValue={v.title}
                        aria-label={fill(labels.renameAria, { title: v.title })}
                        onBlur={(e) => {
                          const next = e.currentTarget.value.trim();
                          if (next && next !== v.title) onRename(i, next);
                          setRenaming(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          else if (e.key === 'Escape') {
                            // preventDefault: en pantalla completa, un Esc no atendido la cierra (main.ts).
                            e.preventDefault();
                            e.stopPropagation();
                            setRenaming(null);
                          }
                        }}
                      />
                    ) : (
                      <span className="views-panel-name" translate="no" title={v.title}>{v.title}</span>
                    )}
                    <button type="button" className="puml-viewer-reset" aria-label={fill(labels.renameAria, { title: v.title })} onClick={() => setRenaming(i)}>
                      {labels.rename}
                    </button>
                    <button type="button" className="puml-viewer-reset" aria-label={fill(labels.moveUpAria, { title: v.title })} disabled={i === 0} onClick={() => onMove(i, i - 1)}>
                      ↑
                    </button>
                    <button type="button" className="puml-viewer-reset" aria-label={fill(labels.moveDownAria, { title: v.title })} disabled={i === views.length - 1} onClick={() => onMove(i, i + 1)}>
                      ↓
                    </button>
                    <button type="button" className="puml-viewer-reset" aria-label={fill(labels.applyAria, { title: v.title })} onClick={() => onApply(i)}>
                      {labels.apply}
                    </button>
                    <button type="button" className="puml-viewer-reset" aria-label={fill(labels.removeAria, { title: v.title })} onClick={() => onRemove(i)}>
                      {labels.remove}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
