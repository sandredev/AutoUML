import { PUML_EXTENSIONS } from '../../shared/validation';
import { useI18n } from '../i18n/I18nProvider';
import './dropOverlay.css';

export type DropPhase = 'idle' | 'dragging' | 'opening';

export interface DropOverlayProps {
  phase: DropPhase;
}

// Solo presentación: nunca recibe eventos (pointer-events: none). El drop lo gestiona App en window.
export function DropOverlay({ phase }: DropOverlayProps) {
  const { t } = useI18n();
  const active = phase !== 'idle';
  const message =
    phase === 'dragging' ? t('drop.prompt') : phase === 'opening' ? t('drop.opening') : '';

  const className = ['drop-overlay', active ? 'is-active' : '', phase === 'opening' ? 'is-opening' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div className={className} aria-hidden="true">
        {active && (
          <div className="drop-overlay-card">
            <svg className="drop-overlay-icon" viewBox="0 0 24 24" width="40" height="40" focusable="false">
              <path
                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path d="M14 2v6h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              <path
                d="M12 11v6m-3-3 3 3 3-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p className="drop-overlay-title">{message}</p>
            {phase === 'dragging' && (
              <p className="drop-overlay-hint">{t('drop.hint', { extensions: PUML_EXTENSIONS.join(', ') })}</p>
            )}
            {phase === 'opening' && <span className="drop-overlay-spinner" />}
          </div>
        )}
      </div>
      <div className="drop-overlay-live" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </div>
    </>
  );
}
