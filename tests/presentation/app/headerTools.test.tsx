// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/presentation/diagram/layout/layout.worker?worker', async () => {
  const { computeLayout } = await import('../../../src/presentation/diagram/layout/layout');
  class FakeWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: unknown = null;
    postMessage(req: { id: number; model: never; opts?: never }): void {
      const result = computeLayout(req.model, req.opts);
      setTimeout(() => this.onmessage?.({ data: { id: req.id, ok: true, result, engine: 'dagre', ms: 1 } }), 0);
    }
    terminate(): void {}
  }
  return { default: FakeWorker };
});

const PUML = '@startuml\nclass Customer\nclass Order\nCustomer --> Order\n@enduml\n';
const ok = <T,>(value: T): Promise<{ ok: true; value: T }> => Promise.resolve({ ok: true, value });
const calls: string[] = [];

const project = {
  meta: { name: 'p', createdAt: '', pumlFile: 'diagram.puml', originalFileName: 'd.puml', pumlLoadedAt: 'x' },
  dir: '/tmp/p',
  puml: { fileName: 'diagram.puml', originalFileName: 'd.puml', lines: 5, sizeBytes: 50 },
};
const overrides: Record<string, unknown> = {
  getStorageInfo: () => Promise.resolve({ root: '/tmp', mode: 'dev', warning: null }),
  listProjects: () => ok([{ name: 'p', createdAt: '', hasPuml: true }]),
  openProject: () => ok(project),
  loadSource: () => ok({ entryPath: '/tmp/p/diagram.puml', entryText: PUML, combined: PUML, files: ['/tmp/p/diagram.puml'], lineMap: [], loadIssues: [] }),
  loadSidecar: () => ok({ state: null, corrupt: false }),
  loadLayers: () => ok({ layers: null, corrupt: false }),
  onPumlFilesChanged: () => () => undefined,
  onCloseRequested: () => () => undefined,
  onMenuAction: () => () => undefined,
  savePng: (...a: unknown[]) => {
    calls.push('savePng');
    void a;
    return ok(null);
  },
};

beforeAll(() => {
  (window as unknown as { autouml: unknown }).autouml = new Proxy(overrides, {
    get: (t, k: string) => t[k] ?? (k === 'history' ? new Proxy({}, { get: () => () => ok([]) }) : () => ok(null)),
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = window.matchMedia ?? ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) as unknown as MediaQueryList);
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? {} : k === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true });
  (Range.prototype as unknown as Record<string, unknown>).getClientRects = () => [];
  (Range.prototype as unknown as Record<string, unknown>).getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  HTMLCanvasElement.prototype.toBlob = ((cb: (b: Blob | null) => void) => cb(new Blob(['x']))) as never;
  HTMLElement.prototype.requestFullscreen = (() => {
    calls.push('requestFullscreen');
    return Promise.resolve();
  }) as never;
  Element.prototype.scrollTo = (() => undefined) as never;
  Element.prototype.scrollIntoView = (() => undefined) as never;
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});
afterEach(cleanup);

describe('herramientas del visor (#34, T11)', () => {
  it('Exportar, Disposición y Pantalla completa responden con un diagrama abierto', async () => {
    const { LocalizationProvider } = await import('../../../src/presentation/localization/LocalizationProvider');
    const { default: App } = await import('../../../src/presentation/app/App');
    render(<LocalizationProvider><App /></LocalizationProvider>);
    // Inicio es la pantalla de arranque: "Diagramas guardados…" abre la lista de diagramas.
    const saved = await waitFor(() => {
      const el = document.querySelector<HTMLButtonElement>('.start-saved');
      if (!el) throw new Error('sin Inicio');
      return el;
    }, { timeout: 3000 });
    fireEvent.click(saved);
    const item = await waitFor(() => {
      const el = document.querySelector('.project-item');
      if (!el) throw new Error('sin item p');
      return el;
    }, { timeout: 3000 });
    fireEvent.click(item);
    const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.puml-viewer-bar button'));
    const byLabel = (re: RegExp) => buttons().find((b) => re.test(b.getAttribute('aria-label') ?? b.getAttribute('title') ?? b.textContent ?? ''));
    await waitFor(() => expect(byLabel(/zoom in/i)).toBeTruthy(), { timeout: 5000 });
    const status = (): string => document.querySelector('.statusbar')?.textContent ?? '';
    await waitFor(() => expect(document.querySelector('canvas')).not.toBeNull(), { timeout: 5000 });

    // Exportar es un menú: PNG está dentro.
    fireEvent.click(buttons().find((b) => /export/i.test(b.textContent ?? ''))!);
    const png = await waitFor(() => {
      const el = Array.from(document.querySelectorAll<HTMLButtonElement>('.menu-popup .menu-item')).find((b) => /png/i.test(b.textContent ?? ''));
      if (!el) throw new Error('sin menú de exportar');
      return el;
    });
    fireEvent.click(png);
    await waitFor(() => expect(calls).toContain('savePng'));

    fireEvent.click(buttons().find((b) => /recompute the layout/i.test(b.getAttribute('title') ?? ''))!);
    await waitFor(() => expect(status()).toMatch(/layout restored/i));

    fireEvent.click(byLabel(/full screen/i)!);
    await waitFor(() => expect(calls).toContain('requestFullscreen'));

    // Totales en la barra de estado.
    await waitFor(() => expect(status()).toMatch(/2 types · 1 relationships/i));
  }, 20000);
});
