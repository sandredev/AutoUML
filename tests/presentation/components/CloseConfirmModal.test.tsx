// tests/presentation/components/CloseConfirmModal.test.tsx — el modal de cierre también sirve para abrir otro documento (T8).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CloseConfirmModal } from '../../../src/presentation/components/CloseConfirmModal';
import { translate } from '../../../src/presentation/localization/translations';

const noop = vi.fn();

describe('CloseConfirmModal', () => {
  it('por defecto pregunta por el cierre de la app', () => {
    const html = renderToStaticMarkup(<CloseConfirmModal saving={false} error={null} dirty onSave={noop} onDiscard={noop} onCancel={noop} />);
    expect(html).toContain(translate('es', 'close.title'));
    expect(html).toContain(translate('es', 'close.discard'));
  });

  it('con purpose="open" pregunta por abrir otro documento: Guardar / Descartar / Cancelar', () => {
    const html = renderToStaticMarkup(
      <CloseConfirmModal purpose="open" saving={false} error={null} dirty onSave={noop} onDiscard={noop} onCancel={noop} />,
    );
    expect(html).toContain(translate('es', 'openDirty.title'));
    expect(html).toContain(translate('es', 'openDirty.message'));
    expect(html).toContain(translate('es', 'openDirty.discard'));
    expect(html).toContain(translate('es', 'close.save'));
    expect(html).toContain(translate('es', 'close.cancel'));
    expect(html).not.toContain(translate('es', 'close.title'));
  });
});
