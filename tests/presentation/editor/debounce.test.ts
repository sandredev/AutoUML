import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncer, LIVE_PARSE_DELAY_MS } from '../../../src/presentation/editor/debounce';

describe('createDebouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('el parseo en vivo espera 250 ms', () => {
    expect(LIVE_PARSE_DELAY_MS).toBe(250);
  });

  it('una ráfaga de cambios produce una sola llamada, con el último valor, 250 ms después del último', () => {
    const fn = vi.fn();
    const d = createDebouncer(fn, 250);
    d.schedule('a');
    vi.advanceTimersByTime(100);
    d.schedule('ab');
    vi.advanceTimersByTime(200);
    d.schedule('abc');
    vi.advanceTimersByTime(249);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('abc');
  });

  it('flush ejecuta ya lo pendiente (p. ej. al guardar) y no lo repite después', () => {
    const fn = vi.fn();
    const d = createDebouncer(fn, 250);
    d.schedule('x');
    expect(d.pending()).toBe(true);
    d.flush();
    expect(fn).toHaveBeenCalledWith('x');
    expect(d.pending()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush sin nada pendiente no llama', () => {
    const fn = vi.fn();
    createDebouncer(fn, 250).flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel descarta lo pendiente (al cambiar de documento o desmontar)', () => {
    const fn = vi.fn();
    const d = createDebouncer(fn, 250);
    d.schedule('x');
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
    expect(d.pending()).toBe(false);
  });
});
