// tests/presentation/diagram/ViewsPanel.test.tsx — anclaje del panel de vistas (T11).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ViewsPanel } from '../../../src/presentation/diagram/ViewsPanel';
import { DEFAULT_LABELS } from '../../../src/presentation/diagram/labels';

const render = (props: Partial<Parameters<typeof ViewsPanel>[0]> = {}): string =>
  renderToStaticMarkup(
    <ViewsPanel
      views={[]}
      labels={DEFAULT_LABELS.views}
      hasFilters={false}
      hasFocus={false}
      hasCollapsed={false}
      onSave={vi.fn()}
      onApply={vi.fn()}
      onRemove={vi.fn()}
      onRename={vi.fn()}
      onMove={vi.fn()}
      onPresent={vi.fn()}
      {...props}
    />,
  );

describe('ViewsPanel', () => {
  it('cerrado: solo el botón, con aria-expanded=false', () => {
    const html = render();
    expect(html).toContain(DEFAULT_LABELS.views.toggle);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain(DEFAULT_LABELS.views.saveHeading);
  });

  it('abierto: el panel va anclado a la izquierda (no lo recorta el lienzo)', () => {
    const html = render({ defaultOpen: true });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('class="filters-panel align-start"');
  });
});
