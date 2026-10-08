import { useEffect, useRef, type JSX, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import './closeConfirmModal.css';

interface CloseConfirmModalProps {
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function CloseConfirmModal({ saving, error, onSave, onDiscard, onCancel }: CloseConfirmModalProps): JSX.Element {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // Foco inicial en Cancelar y restauración del foco anterior al desmontar.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => {
      if (previous && previous.isConnected) previous.focus();
    };
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!saving) onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    const focusable = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled])'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleBackdrop = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !saving) onCancel();
  };

  return (
    <div className="close-confirm-backdrop" onMouseDown={handleBackdrop}>
      <div
        ref={dialogRef}
        className="close-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-confirm-title"
        aria-describedby="close-confirm-message"
        onKeyDown={handleKeyDown}
      >
        <h2 id="close-confirm-title" className="close-confirm__title">{t('close.title')}</h2>
        <p id="close-confirm-message" className="close-confirm__message">{t('close.message')}</p>
        {error && (
          <p className="close-confirm__error" role="alert">{error}</p>
        )}
        <div className="close-confirm__actions">
          <button
            type="button"
            className="close-confirm__btn close-confirm__btn--primary"
            onClick={onSave}
            disabled={saving}
            aria-busy={saving}
          >
            {saving ? t('close.saving') : t('close.save')}
          </button>
          <button
            type="button"
            className="close-confirm__btn close-confirm__btn--danger"
            onClick={onDiscard}
            disabled={saving}
          >
            {t('close.discard')}
          </button>
          <button
            ref={cancelRef}
            type="button"
            className="close-confirm__btn"
            onClick={onCancel}
            disabled={saving}
          >
            {t('close.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
