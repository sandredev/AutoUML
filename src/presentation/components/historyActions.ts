// Acciones del historial de recientes (puras: reciben la API y devuelven qué mostrar). Las usan Inicio y App.
import type { HistoryApi, HistoryEntry, OpenPumlFile } from '../../application/ports/history';
import { PUML_EXTENSIONS } from '../../domain/rules/validation';
import type { Result } from '../../application/ports/ipc';
import type { Status } from './StatusBar';
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
    status: { kind: 'error', text: t('history.reopenUnavailable', { name: value.entry.name, path: value.entry.path }) },
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
