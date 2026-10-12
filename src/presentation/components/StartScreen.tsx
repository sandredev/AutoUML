import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { HistoryApi, HistoryEntry, OpenPumlFile } from '../../application/ports/history';
import { keysOf } from '../../application/shortcuts';
import { useLocalization } from '../localization/LocalizationProvider';
import { withShortcut } from '../localization/translations';
import { reopenEntry, removeEntry, togglePin, type ActionOutcome } from './historyActions';
import { CloseIcon, FileMissingIcon, FolderIcon, PinIcon, PlusIcon } from './Icons';
import type { Status } from './StatusBar';

/** Fecha corta y relativa: "hoy, 8:52 p. m.", "ayer", "9 oct." (año solo si no es el actual). */
export function formatRecentDate(iso: string, locale: string, now: Date = new Date()): { text: string; today: boolean; yesterday: boolean } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { text: iso, today: false, yesterday: false };
  const tag = locale === 'en' ? 'en-US' : 'es-CO';
  const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  const time = d.toLocaleTimeString(tag, { hour: 'numeric', minute: '2-digit' });
  if (diff === 0) return { text: time, today: true, yesterday: false };
  if (diff === 1) return { text: '', today: false, yesterday: true };
  const opts: Intl.DateTimeFormatOptions = d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
  return { text: d.toLocaleDateString(tag, opts), today: false, yesterday: false };
}

export interface RecentsViewProps {
  entries: HistoryEntry[] | null;
  busy: boolean;
  error: string | null;
  /** Recientes recién borrados: se ofrece deshacer bajo la lista. */
  cleared: HistoryEntry[] | null;
  onReopen(entry: HistoryEntry): void;
  onPin(entry: HistoryEntry): void;
  onRemove(entry: HistoryEntry): void;
  onLocate(entry: HistoryEntry): void;
  onClear(): void;
  onUndoClear(): void;
}

/** Lista de Fijados y Recientes (solo presentación). */
export function RecentsView(p: RecentsViewProps): JSX.Element {
  const { t, locale } = useLocalization();
  const entries = p.entries ?? [];
  const pinned = entries.filter((e) => e.pinned);
  const recents = entries.filter((e) => !e.pinned);

  const row = (entry: HistoryEntry): JSX.Element => {
    const date = formatRecentDate(entry.lastOpenedAt, locale);
    const dateText = date.today ? t('start.today', { time: date.text }) : date.yesterday ? t('start.yesterday') : date.text;
    if (!entry.available) {
      return (
        <li key={entry.id} className="recent missing">
          <div className="recent-main" aria-label={t('start.missingAria', { name: entry.name })}>
            <span className="recent-name">{entry.name}</span>
            <span className="recent-path" title={entry.path}>{entry.path}</span>
          </div>
          <div className="recent-missing">
            <span className="recent-gone" role="status"><FileMissingIcon />{t('start.missing')}</span>
            <button type="button" className="ghost-btn" disabled={p.busy} onClick={() => p.onLocate(entry)}>{t('start.locate')}</button>
            <button type="button" className="ghost-btn" disabled={p.busy} onClick={() => p.onRemove(entry)} aria-label={t('start.removeAria', { name: entry.name })}>{t('start.remove')}</button>
          </div>
        </li>
      );
    }
    return (
      <li key={entry.id} className="recent">
        <button type="button" className="recent-main" disabled={p.busy} aria-label={t('start.openAria', { name: entry.name })} onClick={() => p.onReopen(entry)}>
          <span className="recent-name">{entry.name}</span>
          <time className="recent-date" dateTime={entry.lastOpenedAt}>{dateText}</time>
          <span className="recent-path" title={entry.path}>{entry.path}</span>
        </button>
        <div className="recent-actions">
          <button
            type="button"
            className="icon-btn"
            disabled={p.busy}
            aria-pressed={entry.pinned}
            aria-label={t(entry.pinned ? 'start.unpinAria' : 'start.pinAria', { name: entry.name })}
            title={t(entry.pinned ? 'history.unpin' : 'history.pin')}
            onClick={() => p.onPin(entry)}
          >
            <PinIcon filled={entry.pinned} />
          </button>
          {!entry.pinned && (
            <button type="button" className="icon-btn" disabled={p.busy} aria-label={t('start.removeAria', { name: entry.name })} title={t('start.removeTitle')} onClick={() => p.onRemove(entry)}>
              <CloseIcon />
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <>
      {p.error && <p className="start-error" role="alert">{p.error}</p>}
      {pinned.length > 0 && (
        <section aria-labelledby="start-pinned">
          <h2 id="start-pinned" className="start-section">{t('start.pinned')}</h2>
          <ul className="recent-list">{pinned.map(row)}</ul>
        </section>
      )}
      {recents.length > 0 && (
        <section aria-labelledby="start-recents">
          <h2 id="start-recents" className="start-section">{t('start.recents')}</h2>
          <ul className="recent-list">{recents.map(row)}</ul>
        </section>
      )}
      {p.cleared && (
        <p className="start-undo" role="status">
          <span>{t('start.cleared')}</span>
          <button type="button" className="ghost-btn strong" onClick={p.onUndoClear}>{t('common.undo')}</button>
        </p>
      )}
      {p.entries !== null && entries.length === 0 && !p.cleared && (
        <div className="start-empty">
          <p className="start-empty-title">{t('start.firstRunTitle')}</p>
          <p className="muted">{t('start.firstRunBody')}</p>
        </div>
      )}
      {entries.length > 0 && (
        <div className="start-foot">
          <span className="muted">{t('start.dropHint')}</span>
          <button type="button" className="ghost-btn subtle" disabled={p.busy} onClick={p.onClear}>{t('history.clear')}</button>
        </div>
      )}
    </>
  );
}

interface Props {
  api: HistoryApi;
  refreshKey: number;
  onOpened(file: OpenPumlFile): void;
  onStatus(status: Status | null): void;
  onNew(): void;
  onOpenFile(): void;
  onOpenSaved(): void;
}

/** Inicio (T11): "Diagramas" con Nuevo / Abrir y la lista de recientes. Clic en una fila = reabrir. */
export function StartScreen({ api, refreshKey, onOpened, onStatus, onNew, onOpenFile, onOpenSaved }: Props): JSX.Element {
  const { t } = useLocalization();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState<HistoryEntry[] | null>(null);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    const result = await api.list();
    if (result.ok) {
      setEntries(result.value);
      setError(null);
    } else setError(result.error);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const run = useCallback(async (action: () => Promise<ActionOutcome>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const outcome = await action();
      setError(outcome.status?.kind === 'error' ? outcome.status.text : null);
      if (outcome.status) onStatus(outcome.status);
      if (outcome.opened) onOpened(outcome.opened);
      if (outcome.entries) setEntries(outcome.entries);
      if (outcome.refresh) await load();
    } catch (e) {
      const text = e instanceof Error ? e.message : t('history.unknownError');
      setError(text);
      onStatus({ kind: 'error', text });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [load, onOpened, onStatus, t]);

  const undoClear = useCallback((items: HistoryEntry[]) => {
    setCleared(null);
    onStatus(null);
    void run(async () => {
      const r = await api.restore(items);
      return r.ok ? { status: { kind: 'info', text: t('start.restored') }, entries: r.value } : { status: { kind: 'error', text: r.error } };
    });
  }, [api, onStatus, run, t]);

  // Borrar recientes: sin diálogo; se puede deshacer (bajo la lista y en la barra de estado).
  const clear = useCallback(() => {
    const snapshot = entries ?? [];
    if (snapshot.length === 0) return;
    void run(async () => {
      const r = await api.clear();
      if (!r.ok) return { status: { kind: 'error', text: r.error } };
      setCleared(snapshot);
      return { status: { kind: 'info', text: t('start.cleared'), action: { label: t('common.undo'), run: () => undoClear(snapshot) } }, entries: [] };
    });
  }, [api, entries, run, t, undoClear]);

  // "Buscar…" de un reciente que ya no existe: se elige el archivo y la entrada vieja se quita.
  const locate = useCallback((entry: HistoryEntry) => {
    void run(async () => {
      const r = await api.openPumlFile();
      if (!r.ok) return { status: { kind: 'error', text: r.error } };
      if (r.value === null) return { status: null };
      if (r.value.entry.id !== entry.id) await api.remove(entry.id);
      return { status: { kind: 'success', text: t('history.opened', { name: r.value.entry.name }) }, opened: r.value, refresh: true };
    });
  }, [api, run, t]);

  return (
    <div className="start-screen">
      <div className="start-column">
        <div className="start-head">
          <h1>{t('start.title')}</h1>
          <button type="button" className="btn" title={withShortcut(t('start.newTitle'), keysOf('newProject'))} onClick={onNew}>
            <PlusIcon />
            {t('start.newShort')}
          </button>
          <button type="button" className="btn" title={t('start.openTitle')} onClick={onOpenFile}>
            <FolderIcon />
            {t('start.openShort')}
          </button>
        </div>
        <button type="button" className="link-btn start-saved" title={withShortcut(t('start.savedTitle'), keysOf('openProject'))} onClick={onOpenSaved}>
          {t('start.saved')}
        </button>
        <RecentsView
          entries={entries}
          busy={busy}
          error={error}
          cleared={cleared}
          onReopen={(entry) => void run(() => reopenEntry(api, entry, t))}
          onPin={(entry) => void run(() => togglePin(api, entry))}
          onRemove={(entry) => void run(() => removeEntry(api, entry, t))}
          onLocate={locate}
          onClear={clear}
          onUndoClear={() => cleared && undoClear(cleared)}
        />
      </div>
    </div>
  );
}
