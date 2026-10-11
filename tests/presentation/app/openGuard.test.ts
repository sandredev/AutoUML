// tests/presentation/app/openGuard.test.ts — abrir otro documento con cambios sin guardar (fix T7 en T8).
import { describe, expect, it, vi } from 'vitest';
import { createOpenGuard } from '../../../src/presentation/app/openGuard';

function setup(opts: { dirty: boolean; saveOk?: boolean }) {
  let dirty = opts.dirty;
  const save = vi.fn(async () => {
    if (opts.saveOk === false) return false;
    dirty = false;
    return true;
  });
  const onPrompt = vi.fn();
  const onSettled = vi.fn();
  const guard = createOpenGuard({ isDirty: () => dirty, save, onPrompt, onSettled });
  const open = vi.fn();
  return { guard, save, onPrompt, onSettled, open };
}

describe('createOpenGuard', () => {
  it('sin cambios abre en el acto y no pregunta', () => {
    const s = setup({ dirty: false });
    s.guard.request(s.open);
    expect(s.open).toHaveBeenCalledTimes(1);
    expect(s.onPrompt).not.toHaveBeenCalled();
    expect(s.guard.pending()).toBe(false);
  });

  it('con cambios sin guardar pide confirmación y no abre todavía', () => {
    const s = setup({ dirty: true });
    s.guard.request(s.open);
    expect(s.onPrompt).toHaveBeenCalledTimes(1);
    expect(s.open).not.toHaveBeenCalled();
    expect(s.guard.pending()).toBe(true);
  });

  it('Guardar escribe el .puml y después abre', async () => {
    const s = setup({ dirty: true });
    s.guard.request(s.open);
    await expect(s.guard.resolve('save')).resolves.toBe(true);
    expect(s.save).toHaveBeenCalledTimes(1);
    expect(s.open).toHaveBeenCalledTimes(1);
    expect(s.save.mock.invocationCallOrder[0]).toBeLessThan(s.open.mock.invocationCallOrder[0] ?? 0);
    expect(s.onSettled).toHaveBeenCalledTimes(1);
    expect(s.guard.pending()).toBe(false);
  });

  it('Guardar que falla no abre y deja la petición pendiente (el modal sigue)', async () => {
    const s = setup({ dirty: true, saveOk: false });
    s.guard.request(s.open);
    await expect(s.guard.resolve('save')).resolves.toBe(false);
    expect(s.open).not.toHaveBeenCalled();
    expect(s.onSettled).not.toHaveBeenCalled();
    expect(s.guard.pending()).toBe(true);
  });

  it('Descartar abre sin guardar', async () => {
    const s = setup({ dirty: true });
    s.guard.request(s.open);
    await expect(s.guard.resolve('discard')).resolves.toBe(true);
    expect(s.save).not.toHaveBeenCalled();
    expect(s.open).toHaveBeenCalledTimes(1);
    expect(s.onSettled).toHaveBeenCalledTimes(1);
  });

  it('Cancelar no cambia nada: ni guarda ni abre', async () => {
    const s = setup({ dirty: true });
    s.guard.request(s.open);
    await expect(s.guard.resolve('cancel')).resolves.toBe(false);
    expect(s.save).not.toHaveBeenCalled();
    expect(s.open).not.toHaveBeenCalled();
    expect(s.onSettled).toHaveBeenCalledTimes(1);
    expect(s.guard.pending()).toBe(false);
  });

  it('una segunda petición mientras se pregunta sustituye a la primera', async () => {
    const s = setup({ dirty: true });
    const other = vi.fn();
    s.guard.request(s.open);
    s.guard.request(other);
    expect(s.onPrompt).toHaveBeenCalledTimes(1);
    await s.guard.resolve('discard');
    expect(s.open).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('resolver sin petición pendiente no hace nada', async () => {
    const s = setup({ dirty: true });
    await expect(s.guard.resolve('discard')).resolves.toBe(false);
    expect(s.onSettled).not.toHaveBeenCalled();
  });
});
