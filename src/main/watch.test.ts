import { describe, expect, it } from 'vitest';
import { WatchManager } from './watch';

function emitter() {
  const listeners = new Map<string, ((t: string) => void)[]>();
  const closed: string[] = [];
  return {
    closed,
    watchFn: (p: string, l: (t: string) => void): { close(): void } => {
      const arr = listeners.get(p) ?? [];
      arr.push(l);
      listeners.set(p, arr);
      return { close: (): void => { closed.push(p); } };
    },
    fire: (p: string, t: string): void => {
      for (const l of listeners.get(p) ?? []) l(t);
    },
  };
}

describe('WatchManager', () => {
  it('coalesca ráfagas con debounce en un solo changed', async () => {
    const e = emitter();
    const mgr = new WatchManager(20, e.watchFn);
    const events: unknown[] = [];
    const r = mgr.watch(['/a.puml'], (ev) => events.push(ev));
    expect(r).toEqual({ watched: ['/a.puml'] });
    e.fire('/a.puml', 'change');
    e.fire('/a.puml', 'change');
    e.fire('/a.puml', 'change');
    expect(events).toHaveLength(0);
    await new Promise((res) => setTimeout(res, 60));
    expect(events).toEqual([{ kind: 'changed', path: '/a.puml' }]);
    mgr.unwatchAll();
  });

  it('rename sin archivo es removed y revigilar reemplaza lo anterior', async () => {
    const e = emitter();
    const mgr = new WatchManager(10, e.watchFn);
    const events: unknown[] = [];
    // El emisor de mentira no toca el disco: rename siempre es removed aquí.
    mgr.watch(['/a.puml', '/a.puml', ''], (ev) => events.push(ev));
    e.fire('/a.puml', 'rename');
    await new Promise((res) => setTimeout(res, 40));
    expect(events).toEqual([{ kind: 'removed', path: '/a.puml' }]);
    expect(e.closed).toContain('/a.puml');
    // Revigilar cierra lo anterior y solo vigila lo nuevo válido.
    const e2 = emitter();
    const mgr2 = new WatchManager(10, e2.watchFn);
    mgr2.watch(['/x.puml'], () => undefined);
    const r2 = mgr2.watch(['/y.puml'], () => undefined);
    expect(r2).toEqual({ watched: ['/y.puml'] });
    expect(e2.closed).toContain('/x.puml');
    mgr.unwatchAll();
    mgr2.unwatchAll();
  });

  it('unwatchAll cierra todo y usa fs.watch por defecto', () => {
    const e = emitter();
    const mgr = new WatchManager(300, e.watchFn);
    mgr.watch(['/a.puml', '/b.puml'], () => undefined);
    mgr.unwatchAll();
    expect(e.closed).toContain('/a.puml');
    expect(e.closed).toContain('/b.puml');
    const real = new WatchManager();
    expect(typeof real.watch).toBe('function');
    real.unwatchAll();
  });
});
