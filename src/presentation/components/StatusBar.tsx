import type { JSX } from 'react';
import { CloseIcon, WarningIcon } from './Icons';
import { useLocalization } from '../localization/LocalizationProvider';

export interface Status {
  kind: 'info' | 'success' | 'error' | 'warning';
  text: string;
  /** Acción reversible o de recuperación junto al mensaje ("Deshacer", "Reintentar"). */
  action?: { label: string; run: () => void };
  /** Segunda acción secundaria (p. ej. "Detalle"). */
  secondary?: { label: string; run: () => void };
}

interface Props {
  status: Status | null;
  /** Totales del documento: "7 de 16 tipos · 7 relaciones". */
  summary?: string | null;
  onDismiss: () => void;
}

/**
 * Barra de estado (T11): a la izquierda el último mensaje (con su acción, si la tiene); a la derecha los
 * totales del documento. Los errores se quedan hasta cerrarlos; el resto se va solo.
 */
export function StatusBar({ status, summary, onDismiss }: Props): JSX.Element {
  const { t } = useLocalization();
  return (
    <footer className="statusbar">
      <div className="status-msg">
        {status && (
          <span className={`status-${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
            {status.kind === 'warning' && <WarningIcon />}
            <span className="status-text">{status.text}</span>
            {status.action && (
              <button type="button" className="status-action strong" onClick={status.action.run}>{status.action.label}</button>
            )}
            {status.secondary && (
              <button type="button" className="status-action" onClick={status.secondary.run}>{status.secondary.label}</button>
            )}
            <button type="button" className="icon-btn" aria-label={t('status.closeMessage')} onClick={onDismiss}>
              <CloseIcon />
            </button>
          </span>
        )}
      </div>
      <div className="status-summary">{summary ?? ''}</div>
    </footer>
  );
}
