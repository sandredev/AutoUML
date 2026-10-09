import type { JSX } from 'react';
import type { StorageInfo } from '../../shared/ipc';
import { CloseIcon } from './Icons';
import { useI18n } from '../i18n/I18nProvider';

export interface Status {
  kind: 'info' | 'success' | 'error';
  text: string;
}

interface Props {
  status: Status | null;
  storage: StorageInfo | null;
  summary?: string | null;
  onDismiss: () => void;
}

export function StatusBar({ status, storage, summary, onDismiss }: Props): JSX.Element {
  const { t } = useI18n();
  const modeLabel = storage ? t(`status.storage${storage.mode === 'dev' ? 'Dev' : storage.mode === 'exe' ? 'Exe' : 'Fallback'}`) : '';
  return (
    <footer className="statusbar">
      <div className="status-msg">
        {status && (
          <span className={`status-${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
            <span>{status.text}</span>
            <button type="button" className="icon-btn" aria-label={t('status.closeMessage')} onClick={onDismiss}>
              <CloseIcon />
            </button>
          </span>
        )}
      </div>
      <div className="status-summary">{summary ?? ''}</div>
      <div className="status-storage" title={storage ? `${storage.root} (${modeLabel})` : ''}>
        {storage && (
          <>
            <span className="muted">{modeLabel}</span>
            <span className="sep">·</span>
            <span className="status-root">{storage.root}</span>
          </>
        )}
      </div>
    </footer>
  );
}
