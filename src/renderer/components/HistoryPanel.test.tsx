import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { HistoryApi, HistoryEntry } from '../../shared/history';
import {
  clearHistory,
  HistoryView,
  isPumlPath,
  javaMessage,
  openDroppedFiles,
  openJavaDialog,
  openPumlDialog,
  removeEntry,
  reopenEntry,
  saveAs,
  togglePin,
  type HistoryViewProps,
} from './HistoryPanel';

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
    savePumlAs: vi.fn(async () => ({ ok: true as const, value: null })),
    ...overrides,
  };
}

const noop = (): void => undefined;

function renderView(overrides: Partial<HistoryViewProps> = {}): string {
  return renderToStaticMarkup(
    <HistoryView
      entries={[]}
      busy={false}
      error={null}
      canSave={false}
      onOpenPuml={noop}
      onOpenJava={noop}
      onSave={noop}
      onRefresh={noop}
      onClear={noop}
      onReopen={noop}
      onPin={noop}
      onRemove={noop}
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

describe('HistoryView', () => {
  it('muestra el estado vacío y desactiva guardar sin contenido', () => {
    const html = renderView();
    expect(html).toContain('Historial vacío');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Guardar como/);
  });

  it('muestra la ruta y el estado fijado', () => {
    const html = renderView({ entries: [entry({ pinned: true })], canSave: true });
    expect(html).toContain('/tmp/a.puml');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Desfijar');
  });

  it('desactiva reabrir para una entrada no disponible', () => {
    const html = renderView({ entries: [entry({ available: false })] });
    expect(html).toContain('No disponible');
    expect(html).toMatch(/<button[^>]*aria-label="Reabrir a\.puml"[^>]*disabled=""/);
  });

  it('expone errores como alerta accesible', () => {
    expect(renderView({ error: 'Fallo' })).toContain('role="alert"');
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

  it('limpia solo después de confirmar', async () => {
    const api = makeApi();
    expect((await clearHistory(api, () => false)).status).toBeNull();
    expect(api.clear).not.toHaveBeenCalled();
    expect((await clearHistory(api, () => true)).entries).toEqual([]);
    expect(api.clear).toHaveBeenCalledTimes(1);
  });

  it('trata cancelar abrir PUML como cancelación normal', async () => {
    expect((await openPumlDialog(makeApi())).status).toBeNull();
  });

  it('propaga error al abrir PUML', async () => {
    const api = makeApi({ openPumlFile: vi.fn(async () => ({ ok: false as const, error: 'Archivo grande' })) });
    expect((await openPumlDialog(api)).status?.text).toBe('Archivo grande');
  });

  it('informa al elegir una carpeta Java sin crear un diagrama', async () => {
    const api = makeApi({ openJavaProject: vi.fn(async () => ({ ok: true as const, value: entry({ kind: 'java' }) })) });
    const outcome = await openJavaDialog(api);
    expect(outcome.status?.kind).toBe('info');
    expect(outcome.opened).toBeUndefined();
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
