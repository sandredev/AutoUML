import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { HistoryApi, HistoryEntry } from '../../../src/application/ports/history';
import {
  isPumlPath,
  javaMessage,
  openDroppedFiles,
  removeEntry,
  reopenEntry,
  saveAs,
  togglePin,
} from '../../../src/presentation/components/historyActions';
import { formatRecentDate, RecentsView, type RecentsViewProps } from '../../../src/presentation/components/StartScreen';

const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 'puml:a',
  kind: 'puml',
  path: '/tmp/a.puml',
  name: 'a.puml',
  lastOpenedAt: '2026-01-01T10:00:00.000Z',
  pinned: false,
  available: true,
  ...overrides,
});

function makeApi(overrides: Partial<HistoryApi> = {}): HistoryApi {
  return {
    list: vi.fn(async () => ({ ok: true as const, value: [entry()] })),
    openPumlFile: vi.fn(async () => ({ ok: true as const, value: null })),
    openPumlPath: vi.fn(async () => ({
      ok: true as const,
      value: { entry: entry(), source: '@startuml\n@enduml' },
    })),
    openJavaProject: vi.fn(async () => ({ ok: true as const, value: null })),
    reopen: vi.fn(async () => ({
      ok: true as const,
      value: { kind: 'missing' as const, entry: entry() },
    })),
    setPinned: vi.fn(async () => ({ ok: true as const, value: [entry({ pinned: true })] })),
    remove: vi.fn(async () => ({ ok: true as const, value: [] })),
    clear: vi.fn(async () => ({ ok: true as const, value: undefined })),
    restore: vi.fn(async () => ({ ok: true as const, value: [entry()] })),
    savePumlAs: vi.fn(async () => ({ ok: true as const, value: null })),
    ...overrides,
  };
}

const noop = (): void => undefined;

function renderView(overrides: Partial<RecentsViewProps> = {}): string {
  return renderToStaticMarkup(
    <RecentsView
      entries={[]}
      busy={false}
      error={null}
      cleared={null}
      onReopen={noop}
      onPin={noop}
      onRemove={noop}
      onLocate={noop}
      onClear={noop}
      onUndoClear={noop}
      {...overrides}
    />,
  );
}

describe('isPumlPath', () => {
  it('acepta extensiones admitidas e ignora mayúsculas', () => {
    expect(isPumlPath('A.PUML')).toBe(true);
    expect(isPumlPath('x.plantuml')).toBe(true);
    expect(isPumlPath('x.pu')).toBe(true);
    expect(isPumlPath('x.txt')).toBe(false);
    expect(isPumlPath('.puml')).toBe(false);
  });
});

describe('Recientes en Inicio (T11)', () => {
  it('primera ejecución: explica qué hacer cuando no hay recientes', () => {
    const html = renderView();
    expect(html).toContain('Aún no has abierto ningún diagrama');
    expect(html).not.toContain('Borrar recientes');
  });

  it('separa fijados y recientes, y la fila entera abre', () => {
    const html = renderView({ entries: [entry({ pinned: true }), entry({ id: 'b', name: 'b.puml', path: '/tmp/b.puml' })] });
    expect(html).toContain('Fijados');
    expect(html).toContain('Recientes');
    expect(html).toContain('aria-label="Abrir a.puml"');
    expect(html).toContain('aria-label="Desfijar a.puml"');
    expect(html).toContain('/tmp/b.puml');
  });

  it('un reciente que ya no existe dice "No se encuentra" como estado, con Buscar y Quitar', () => {
    const html = renderView({ entries: [entry({ available: false })] });
    expect(html).toContain('No se encuentra');
    expect(html).toContain('Buscar…');
    expect(html).toContain('aria-label="Quitar a.puml de recientes"');
    expect(html).not.toContain('aria-label="Abrir a.puml"');
    expect(html).not.toContain('opacity');
  });

  it('tras borrar ofrece deshacer y expone errores como alerta', () => {
    expect(renderView({ cleared: [entry()] })).toContain('Deshacer');
    expect(renderView({ error: 'Fallo' })).toContain('role="alert"');
  });

  it('fecha corta y relativa', () => {
    const now = new Date(2026, 9, 12, 21, 0);
    expect(formatRecentDate(new Date(2026, 9, 12, 20, 52).toISOString(), 'es', now).today).toBe(true);
    expect(formatRecentDate(new Date(2026, 9, 11, 9, 0).toISOString(), 'es', now).yesterday).toBe(true);
    expect(formatRecentDate(new Date(2026, 9, 9).toISOString(), 'es', now).text).not.toContain('2026');
    expect(formatRecentDate(new Date(2025, 9, 9).toISOString(), 'es', now).text).toContain('2025');
  });
});

describe('acciones del historial', () => {
  it('no reabre recursos no disponibles', async () => {
    const api = makeApi();
    const outcome = await reopenEntry(api, entry({ available: false }));
    expect(api.reopen).not.toHaveBeenCalled();
    expect(outcome.status?.kind).toBe('error');
  });

  it('devuelve el PUML reabierto', async () => {
    const api = makeApi({
      reopen: vi.fn(async () => ({
        ok: true as const,
        value: { kind: 'puml' as const, entry: entry(), source: 'diagram' },
      })),
    });
    const outcome = await reopenEntry(api, entry());
    expect(outcome.opened?.source).toBe('diagram');
    expect(outcome.refresh).toBe(true);
  });

  it('reabrir Java solo informa que el parser no está integrado', async () => {
    const java = entry({ kind: 'java', path: '/src/app' });
    const api = makeApi({
      reopen: vi.fn(async () => ({
        ok: true as const,
        value: { kind: 'java' as const, entry: java, projectPath: '/src/app' },
      })),
    });
    const outcome = await reopenEntry(api, java);
    expect(outcome.opened).toBeUndefined();
    expect(outcome.status?.text).toContain('no está integrado');
    expect(javaMessage('/src/app')).toContain('/src/app');
  });

  it('propaga errores al reabrir', async () => {
    const api = makeApi({ reopen: vi.fn(async () => ({ ok: false as const, error: 'boom' })) });
    expect((await reopenEntry(api, entry())).status).toEqual({ kind: 'error', text: 'boom' });
  });

  it('alterna el fijado', async () => {
    const api = makeApi();
    const outcome = await togglePin(api, entry());
    expect(api.setPinned).toHaveBeenCalledWith('puml:a', true);
    expect(outcome.entries?.[0].pinned).toBe(true);
  });

  it('quita solo la referencia del historial', async () => {
    const api = makeApi();
    const outcome = await removeEntry(api, entry());
    expect(api.remove).toHaveBeenCalledWith('puml:a');
    expect(outcome.entries).toEqual([]);
    expect(outcome.status?.text).toContain('no se borró');
  });

  it('maneja guardar como sin texto, cancelación y éxito', async () => {
    const api = makeApi();
    expect((await saveAs(api, null, 'a.puml')).status?.kind).toBe('error');
    expect(api.savePumlAs).not.toHaveBeenCalled();
    expect((await saveAs(api, 'diagram', 'a.puml')).status).toBeNull();
    const saved = makeApi({ savePumlAs: vi.fn(async () => ({ ok: true as const, value: '/out/a.puml' })) });
    expect((await saveAs(saved, 'diagram', 'a.puml')).status?.kind).toBe('success');
  });

  it('filtra el drop y manda el archivo al bridge', async () => {
    const file = { name: 'a.puml' } as File;
    const openFile = vi.fn(async () => ({ ok: true as const, value: { entry: entry(), source: 'diagram' } }));
    expect((await openDroppedFiles([{ name: 'x.png' } as File], openFile)).status?.kind).toBe('error');
    expect(openFile).not.toHaveBeenCalled();
    const outcome = await openDroppedFiles([file], openFile);
    expect(openFile).toHaveBeenCalledWith(file);
    expect(outcome.opened?.source).toBe('diagram');
    const rejected = await openDroppedFiles([file], async () => ({ ok: false, error: 'inválido' }));
    expect(rejected.status?.text).toBe('inválido');
  });
});
