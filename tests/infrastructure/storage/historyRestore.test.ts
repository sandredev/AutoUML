import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, ipcMain: { handle: () => undefined } }));
vi.mock('electron-store', () => ({ default: class {} }));

const { createHistoryStore } = await import('../../../src/infrastructure/storage/history');

function memory() {
  let data: unknown = [];
  return { read: () => data, write: (e: unknown[]) => { data = e; } };
}

describe('historial: deshacer "Borrar recientes" (T11)', () => {
  const opts = { platform: 'linux' as const, now: () => new Date('2026-10-12T10:00:00Z'), exists: async () => true };

  it('restaura lo borrado con su fijado y fecha, sin duplicar lo que ya estaba', async () => {
    const store = createHistoryStore(memory(), opts);
    await store.record('puml', '/tmp/a.puml', 'a.puml');
    const recorded = await store.record('puml', '/tmp/b.puml', 'b.puml');
    const before = await store.setPinned(recorded.find((e) => e.name === 'b.puml')!.id, true);
    await store.clear();
    expect(await store.list()).toEqual([]);
    await store.record('puml', '/tmp/a.puml', 'a.puml');
    const after = await store.restore(before);
    expect(after.map((e) => [e.name, e.pinned])).toEqual([['b.puml', true], ['a.puml', false]]);
  });

  it('recalcula el id desde tipo y ruta e ignora lo que no es válido', async () => {
    const store = createHistoryStore(memory(), opts);
    const out = await store.restore([
      { kind: 'puml', path: '/tmp/x.puml', name: 'x.puml', lastOpenedAt: 'no-es-fecha', pinned: false },
      { kind: 'otro' as 'puml', path: '/tmp/y.puml', name: 'y', lastOpenedAt: '2026-01-01T00:00:00Z', pinned: false },
      { kind: 'puml', path: '', name: 'vacía', lastOpenedAt: '2026-01-01T00:00:00Z', pinned: false },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.lastOpenedAt).toBe('2026-10-12T10:00:00.000Z');
    expect(out[0]?.id).toMatch(/^[0-9a-f]{40}$/);
  });
});
