import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DropOverlay } from '../../../src/presentation/components/DropOverlay';

describe('DropOverlay', () => {
  it('is visually inactive and keeps the live region empty while idle', () => {
    const html = renderToStaticMarkup(<DropOverlay phase="idle" />);

    expect(html).toContain('class="drop-overlay"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('drop-overlay-card');
    expect(html).not.toContain('Suelta el diagrama');
  });

  it('announces the prompt and accepted extensions while dragging', () => {
    const html = renderToStaticMarkup(<DropOverlay phase="dragging" />);

    expect(html).toContain('Suelta el diagrama para abrirlo');
    expect(html).toContain('Formatos aceptados: .puml, .plantuml, .pu');
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"');
  });

  it('shows the opening state without a progress percentage', () => {
    const html = renderToStaticMarkup(<DropOverlay phase="opening" />);

    expect(html).toContain('Abriendo diagrama…');
    expect(html).toContain('drop-overlay-spinner');
    expect(html).not.toContain('Formatos aceptados');
    expect(html).not.toContain('%');
  });
});
