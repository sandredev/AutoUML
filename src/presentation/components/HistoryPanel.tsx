import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryApi, HistoryEntry, OpenPumlFile } from '../../application/ports/history';
import { PUML_EXTENSIONS } from '../../domain/rules/validation';
import type { Result } from '../../application/ports/ipc';
import type { Status } from './StatusBar';
import { useLocalization } from '../localization/LocalizationProvider';
import { translate } from '../localization/translations';
import type { TranslateFn } from '../localization/LocalizationProvider';

const spanish: TranslateFn = (key, params) => translate('es', key, params);

export function isPumlPath(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return PUML_EXTENSIONS.some((extension) => lower.endsWith(extension) && lower.length > extension.length);
}

export function formatDate(iso: string, locale = 'es-CO'): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(locale);
}

export function javaMessage(projectPath: string, t: TranslateFn = spanish): string {
  return t('history.javaRegistered', { path: projectPath });
}

export interface ActionOutcome {
  status: Status | null;
  entries?: HistoryEntry[];
  opened?: OpenPumlFile;
  refresh?: boolean;
}

const fail = (text: string): ActionOutcome => ({ status: { kind: 'error', text } });
const openedOutcome = (file: OpenPumlFile, t: TranslateFn = spanish): ActionOutcome => ({
  status: { kind: 'success', text: t('history.opened', { name: file.entry.name }) },
  opened: file,
  refresh: true,
});

export async function openPumlDialog(api: HistoryApi, t: TranslateFn = spanish): Promise<ActionOutcome> {
  const result = await api.openPumlFile();
  if (!result.ok) return fail(result.error);
  return result.value === null ? { status: null } : openedOutcome(result.value, t);
}

export async function openJavaDialog(api: HistoryApi, t: TranslateFn = spanish): Promise<ActionOutcome> {
  const result = await api.openJavaProject();
  if (!result.ok) return fail(result.error);
  if (result.value === null) return { status: null };
  return { status: { kind: 'info', text: javaMessage(result.value.path, t) }, refresh: true };
}

export async function reopenEntry(api: HistoryApi, entry: HistoryEntry, t: TranslateFn = spanish): Promise<ActionOutcome> {
  if (!entry.available) {
    return fail(t('history.reopenUnavailable', { name: entry.name, path: entry.path }));
  }
  const result = await api.reopen(entry.id);
  if (!result.ok) return fail(result.error);
  const value = result.value;
  if (value.kind === 'puml') return openedOutcome({ entry: value.entry, source: value.source }, t);
  if (value.kind === 'java') {
    return { status: { kind: 'info', text: javaMessage(value.projectPath, t) }, refresh: true };
  }
  return {
    status: { kind: 'error', text: `"${value.entry.name}" ya no existe en ${value.entry.path}.` },
    refresh: true,
  };
}

export async function togglePin(api: HistoryApi, entry: HistoryEntry): Promise<ActionOutcome> {
  const result = await api.setPinned(entry.id, !entry.pinned);
  return result.ok ? { status: null, entries: result.value } : fail(result.error);
}

export async function removeEntry(api: HistoryApi, entry: HistoryEntry, t: TranslateFn = spanish): Promise<ActionOutcome> {
  const result = await api.remove(entry.id);
  if (!result.ok) return fail(result.error);
  return {
    status: { kind: 'info', text: t('history.removed', { name: entry.name }) },
    entries: result.value,
  };
}

export async function clearHistory(
  api: HistoryApi,
  confirm: (message: string) => boolean,
  t: TranslateFn = spanish,
): Promise<ActionOutcome> {
  if (!confirm(t('history.confirmClear'))) return { status: null };
  const result = await api.clear();
  if (!result.ok) return fail(result.error);
  return { status: { kind: 'info', text: t('history.cleared') }, entries: [] };
}

export async function saveAs(
  api: HistoryApi,
  source: string | null,
  suggestedName: string,
  t: TranslateFn = spanish,
): Promise<ActionOutcome> {
  if (source === null || source.length === 0) return fail(t('history.noCurrentPuml'));
  const result = await api.savePumlAs(source, suggestedName);
  if (!result.ok) return fail(result.error);
  if (result.value === null) return { status: null };
  return { status: { kind: 'success', text: t('history.saved', { path: result.value }) }, refresh: true };
}

export async function openDroppedFiles(
  files: File[],
  openFile: (file: File) => Promise<Result<OpenPumlFile>>,
  t: TranslateFn = spanish,
): Promise<ActionOutcome> {
  if (files.length === 0) return { status: null };
  const file = files.find((candidate) => isPumlPath(candidate.name));
  if (!file) return fail(t('history.onlyExtensions', { extensions: PUML_EXTENSIONS.join(', ') }));
  const result = await openFile(file);
  return result.ok ? openedOutcome(result.value, t) : fail(result.error);
}

export interface HistoryViewProps {
  entries: HistoryEntry[] | null;
  busy: boolean;
  error: string | null;
  canSave: boolean;
  onOpenPuml(): void;
  onOpenJava(): void;
  onSave(): void;
  onRefresh(): void;
  onClear(): void;
  onReopen(entry: HistoryEntry): void;
  onPin(entry: HistoryEntry): void;
  onRemove(entry: HistoryEntry): void;
}

export function HistoryView(props: HistoryViewProps) {
  const { t, locale } = useLocalization();
  const entries = props.entries ?? [];
  return (
    <aside className="history-panel" aria-label={t('history.aria')} aria-busy={props.busy}>
      <div className="history-header">
        <span>{t('history.title')}</span>
        {props.busy && <span className="history-busy" role="status">{t('history.working')}</span>}
      </div>
      <div className="history-actions">
        <button type="button" className="btn" disabled={props.busy} onClick={props.onOpenPuml}>{t('history.openPuml')}</button>
        <button type="button" className="btn" disabled={props.busy} onClick={props.onOpenJava}>{t('history.javaFolder')}</button>
        <button type="button" className="btn" disabled={props.busy || !props.canSave} onClick={props.onSave}>{t('history.saveAs')}</button>
        <button type="button" className="btn" disabled={props.busy} onClick={props.onRefresh}>{t('history.reload')}</button>
        <button type="button" className="btn" disabled={props.busy || entries.length === 0} onClick={props.onClear}>{t('history.clear')}</button>
      </div>
      {props.error && <div className="history-error" role="alert">{props.error}</div>}
      {props.entries !== null && entries.length === 0 && <p className="history-empty muted">{t('history.empty')}</p>}
      <ul className="history-list">
        {entries.map((entry) => (
          <li key={entry.id} className={entry.available ? 'history-item' : 'history-item unavailable'}>
            <div className="history-row">
              <span className="history-name">{entry.name}</span>
              <span className="badge">{entry.kind === 'puml' ? 'PUML' : 'Java'}</span>
              {!entry.available && <span className="badge badge-missing">{t('history.unavailable')}</span>}
            </div>
            <div className="history-path" title={entry.path}>{entry.path}</div>
            <time className="history-date" dateTime={entry.lastOpenedAt}>{formatDate(entry.lastOpenedAt, locale === 'en' ? 'en-US' : 'es-CO')}</time>
            <div className="history-row">
              <button type="button" className="btn btn-small" aria-label={`${t('history.reopen')} ${entry.name}`} disabled={props.busy || !entry.available} onClick={() => props.onReopen(entry)}>{t('history.reopen')}</button>
              <button type="button" className="btn btn-small" aria-label={`${entry.pinned ? t('history.unpin') : t('history.pin')} ${entry.name}`} aria-pressed={entry.pinned} disabled={props.busy} onClick={() => props.onPin(entry)}>{entry.pinned ? t('history.unpin') : t('history.pin')}</button>
              <button type="button" className="btn btn-small" aria-label={`${t('history.remove')} ${entry.name}`} disabled={props.busy} onClick={() => props.onRemove(entry)}>{t('history.remove')}</button>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export interface HistoryPanelProps {
  api: HistoryApi;
  source: string | null;
  suggestedName: string;
  refreshKey: number;
  onOpened(file: OpenPumlFile): void;
  onStatus(status: Status | null): void;
  confirm?: (message: string) => boolean;
}

export function HistoryPanel({ api, source, suggestedName, refreshKey, onOpened, onStatus, confirm }: HistoryPanelProps) {
  const { t } = useLocalization();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    const result = await api.list();
    if (result.ok) {
      setEntries(result.value);
      setError(null);
    } else {
      setError(result.error);
    }
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
    } catch (error) {
      const text = error instanceof Error ? error.message : t('history.unknownError');
      setError(text);
      onStatus({ kind: 'error', text });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [load, onOpened, onStatus, t]);

  const ask = confirm ?? ((message: string) => window.confirm(message));

  return (
    <HistoryView
      entries={entries}
      busy={busy}
      error={error}
      canSave={source !== null && source.length > 0}
      onOpenPuml={() => void run(() => openPumlDialog(api, t))}
      onOpenJava={() => void run(() => openJavaDialog(api, t))}
      onSave={() => void run(() => saveAs(api, source, suggestedName, t))}
      onRefresh={() => void run(async () => { await load(); return { status: null }; })}
      onClear={() => void run(() => clearHistory(api, ask, t))}
      onReopen={(entry) => void run(() => reopenEntry(api, entry, t))}
      onPin={(entry) => void run(() => togglePin(api, entry))}
      onRemove={(entry) => void run(() => removeEntry(api, entry, t))}
    />
  );
}
