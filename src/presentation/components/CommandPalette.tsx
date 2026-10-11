// Paleta de comandos (Ctrl+K, T10): búsqueda difusa sobre clases y paquetes. Combobox + listbox con
// la opción activa anunciada (aria-activedescendant). Pura UI: quien la abre decide qué hace elegir.
import { useEffect, useId, useMemo, useRef, useState, type JSX } from 'react';
import { fill, type PaletteLabels } from '../diagram/labels';
import { fuzzySearch } from '../diagram/palette/fuzzy';

export interface PaletteItem {
  id: string;
  label: string;
  kind: 'class' | 'package';
  /** Texto secundario (paquete de la clase). */
  detail?: string;
}

interface Props {
  items: readonly PaletteItem[];
  labels: PaletteLabels;
  onPick: (item: PaletteItem) => void;
  onClose: () => void;
}

const MAX_RESULTS = 50;

/** Parte `text` en tramos resaltados según los índices coincidentes. */
function highlight(text: string, indices: readonly number[]): (string | JSX.Element)[] {
  const hit = new Set(indices);
  const out: (string | JSX.Element)[] = [];
  let run = '';
  let runHit = false;
  const flush = (): void => {
    if (!run) return;
    out.push(runHit ? <mark key={out.length}>{run}</mark> : run);
    run = '';
  };
  for (let i = 0; i < text.length; i++) {
    const h = hit.has(i);
    if (h !== runHit) {
      flush();
      runHit = h;
    }
    run += text[i];
  }
  flush();
  return out;
}

export function CommandPalette({ items, labels, onPick, onClose }: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;

  const results = useMemo(() => fuzzySearch(query, items, MAX_RESULTS), [query, items]);
  const current = results.length === 0 ? -1 : Math.min(active, results.length - 1);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    listRef.current?.children[current]?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  const move = (delta: number): void => {
    if (results.length === 0) return;
    setActive((Math.max(current, 0) + delta + results.length) % results.length);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Home' || e.key === 'End') {
      if (results.length > 0) {
        e.preventDefault();
        setActive(e.key === 'Home' ? 0 : results.length - 1);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (current >= 0) onPick(results[current].item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const optionId = (i: number): string => `${baseId}-opt-${i}`;

  return (
    <div className="command-palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="command-palette" role="dialog" aria-label={labels.title}>
        <input
          ref={inputRef}
          className="command-palette-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={current >= 0 ? optionId(current) : undefined}
          aria-label={labels.title}
          placeholder={labels.placeholder}
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul id={listId} ref={listRef} className="command-palette-list" role="listbox" aria-label={labels.title}>
          {results.map((r, i) => (
            <li
              key={`${r.item.kind}:${r.item.id}`}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              className={i === current ? 'command-palette-option is-active' : 'command-palette-option'}
              onPointerMove={() => i !== current && setActive(i)}
              onClick={() => onPick(r.item)}
            >
              <span className="command-palette-label" translate="no">{highlight(r.item.label, r.indices)}</span>
              {r.item.detail ? <span className="command-palette-detail" translate="no">{r.item.detail}</span> : null}
              <span className="command-palette-kind">
                {r.item.kind === 'package' ? labels.kindPackage : labels.kindClass}
              </span>
            </li>
          ))}
        </ul>
        <p className="command-palette-foot" role="status" aria-live="polite">
          {results.length === 0 ? labels.empty : fill(labels.results, { n: String(results.length) })}
        </p>
        <p className="command-palette-hint" aria-hidden="true">{labels.hint}</p>
      </div>
    </div>
  );
}
