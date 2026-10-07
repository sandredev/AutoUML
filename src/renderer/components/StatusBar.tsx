import type { JSX } from 'react';
import type { StorageInfo } from '../../shared/ipc';
import { CloseIcon } from './Icons';

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

const MODE_LABEL: Record<StorageInfo['mode'], string> = {
  dev: 'desarrollo',
  exe: 'junto al ejecutable',
  fallback: 'carpeta alternativa',
};

export function StatusBar({ status, storage, summary, onDismiss }: Props): JSX.Element {
  return (
    <footer className="statusbar">
      <div className="status-msg">
        {status && (
          <span className={`status-${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
            <span>{status.text}</span>
            <button type="button" className="icon-btn" aria-label="Cerrar mensaje" onClick={onDismiss}>
              <CloseIcon />
            </button>
          </span>
        )}
      </div>
      <div className="status-summary">{summary ?? ''}</div>
      <div className="status-storage" title={storage ? `${storage.root} (${MODE_LABEL[storage.mode]})` : ''}>
        {storage && (
          <>
            <span className="muted">{MODE_LABEL[storage.mode]}</span>
            <span className="sep">·</span>
            <span className="status-root">{storage.root}</span>
          </>
        )}
      </div>
    </footer>
  );
}
