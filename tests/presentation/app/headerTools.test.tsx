// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('herramientas del header (#34)', () => {
  it('Exportar, Relayout y Encuadrar responden con un diagrama abierto', async () => {
    const { LocalizationProvider } = await import('../../../src/presentation/localization/LocalizationProvider');
    const { default: App } = await import('../../../src/presentation/app/App');
    render(<LocalizationProvider><App /></LocalizationProvider>);
    await waitFor(() => expect(screen.getByRole('button', { name: /p/ })).toBeTruthy(), { timeout: 3000 }).catch(() => undefined);
    const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.toolbar .tool-btn'));
    const report = (): string => buttons().map((b) => `${b.getAttribute('aria-label')}:${b.disabled ? 'off' : 'on'}`).join(' | ');
    fireEvent.click(document.querySelector('.choice-btn')!);
    const item = await waitFor(() => {
      const el = document.querySelector('.project-item');
      if (!el) throw new Error('sin item p');
      return el;
    }, { timeout: 3000 });
    fireEvent.click(item);
    await waitFor(() => expect(/Zoom in[^|]*:on/.test(report())).toBe(true), { timeout: 5000 });
    const byLabel = (re: RegExp) => buttons().find((b) => re.test(b.getAttribute('aria-label') ?? ''))!;
    const status = (): string => document.querySelector('.statusbar, .status-bar, footer')?.textContent ?? '';
    await waitFor(() => expect(document.querySelector('canvas')).not.toBeNull(), { timeout: 5000 });

    fireEvent.click(byLabel(/export/i));
    await waitFor(() => expect(calls).toContain('savePng'));

    fireEvent.click(byLabel(/restore|relayout/i));
    await waitFor(() => expect(status()).toMatch(/layout restored/i));

    fireEvent.click(byLabel(/full screen|fit/i));
    await waitFor(() => expect(calls).toContain('requestFullscreen'));
  }, 20000);
});
