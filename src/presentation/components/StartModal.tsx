import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import type { ProjectInfo, ProjectSummary } from '../../application/ports/ipc';
import { MAX_PROJECT_NAME_LENGTH, validateProjectName } from '../../domain/rules/validation';
import { CloseIcon, FolderIcon, PlusIcon } from './Icons';
import { useLocalization } from '../localization/LocalizationProvider';

type View = 'choose' | 'new' | 'list';

interface Props {
  dismissable: boolean;
  onClose: () => void;
  onOpened: (project: ProjectInfo) => void;
}

const api = window.autouml;

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale === 'en' ? 'en-US' : 'es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function StartModal({ dismissable, onClose, onOpened }: Props): JSX.Element {
  const { t, locale } = useLocalization();
  const [view, setView] = useState<View>('choose');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const nameError = validateProjectName(name);
  const showNameError = touched && nameError !== null;
  const listLoaded = projects !== null;

  const nameErrorText = (error: string | null): string | null => {
    if (!error) return null;
    if (error.startsWith('El nombre no puede estar vacío')) return t('start.validation.empty');
    const length = error.match(/como máximo (\d+) caracteres/);
    if (length) return t('start.validation.length', { max: length[1] ?? MAX_PROJECT_NAME_LENGTH });
    if (error.startsWith('El nombre no puede contener /')) return t('start.validation.chars');
    if (error.startsWith('El nombre no puede contener caracteres')) return t('start.validation.control');
    if (error.startsWith('El nombre no puede terminar')) return t('start.validation.trailing');
    const reserved = error.match(/^"(.+)" es un nombre reservado/);
    if (reserved) return t('start.validation.reserved', { name: reserved[1] ?? '' });
    return error;
  };

  const goTo = (next: View) => {
    setView(next);
    setNotice(null);
    setServerError(null);
    if (next === 'new') {
      setName('');
      setTouched(false);
    }
  };

  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [view, listLoaded]);

  useEffect(() => {
    if (view !== 'list') return;
    let cancelled = false;
    setProjects(null);
    void api.listProjects().then((r) => {
      if (cancelled) return;
      if (r.ok) setProjects(r.value);
      else {
        setProjects([]);
        setNotice(r.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return;
      e.preventDefault();
      if (view !== 'choose') goTo('choose');
      else if (dismissable) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, dismissable, busy, onClose]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (nameError || busy) return;
    setBusy(true);
    setServerError(null);
    try {
      const r = await api.createProject(name.trim());
      if (r.ok) onOpened(r.value);
      else setServerError(r.error);
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = async (projectName: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.openProject(projectName);
      if (r.ok) onOpened(r.value);
      else setNotice(r.error);
    } finally {
      setBusy(false);
    }
  };

  const title = view === 'choose' ? 'AutoUML' : view === 'new' ? t('start.newProject') : t('start.openProject');

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissable && !busy) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="start-modal-title">
        <div className="modal-header">
          <h2 id="start-modal-title">{title}</h2>
          {dismissable && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t('start.close')} title={`${t('start.close')} (Esc)`}>
              <CloseIcon />
            </button>
          )}
        </div>

        <div className="modal-body" ref={bodyRef}>
          {view === 'choose' && (
            <>
              <p className="modal-subtitle">{t('start.subtitle')}</p>
              <div className="choice-grid">
                <button type="button" className="choice-btn" onClick={() => goTo('list')}>
                  <FolderIcon />
                  <span className="choice-label">{t('start.load')}</span>
                  <span className="choice-hint">{t('start.openExisting')}</span>
                </button>
                <button type="button" className="choice-btn" onClick={() => goTo('new')}>
                  <PlusIcon />
                  <span className="choice-label">{t('start.new')}</span>
                  <span className="choice-hint">{t('start.createEmpty')}</span>
                </button>
              </div>
            </>
          )}

          {view === 'new' && (
            <form onSubmit={(e) => void handleCreate(e)} noValidate>
              <label className="field-label" htmlFor="project-name">
                {t('start.projectName')}
              </label>
              <input
                id="project-name"
                className={`text-input${showNameError || serverError ? ' invalid' : ''}`}
                value={name}
                maxLength={MAX_PROJECT_NAME_LENGTH + 10}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={showNameError || serverError !== null}
                aria-describedby="project-name-msg"
                onChange={(e) => {
                  setName(e.target.value);
                  setTouched(true);
                  setServerError(null);
                }}
              />
              <p id="project-name-msg" className={`field-msg${showNameError || serverError ? ' error' : ''}`}>
                {showNameError ? nameErrorText(nameError) : serverError ?? t('start.createFolderHint')}
              </p>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => goTo('choose')} disabled={busy}>
                  {t('start.back')}
                </button>
                <button type="submit" className="btn btn-primary" disabled={nameError !== null || busy}>
                  {busy ? t('start.creating') : t('start.create')}
                </button>
              </div>
            </form>
          )}

          {view === 'list' && (
            <>
              {notice && (
                <p className="field-msg error" role="alert">
                  {notice}
                </p>
              )}
              {!listLoaded && <p className="muted">{t('start.loading')}</p>}
              {listLoaded && projects.length === 0 && (
                <div className="empty-list">
                  <p>{t('start.noProjects')}</p>
                  <button type="button" className="btn btn-primary" onClick={() => goTo('new')}>
                    {t('start.createNew')}
                  </button>
                </div>
              )}
              {listLoaded && projects.length > 0 && (
                <ul className="project-list">
                  {projects.map((p) => (
                    <li key={p.name}>
                      <button
                        type="button"
                        className="project-item"
                        disabled={busy}
                        onClick={() => void handleOpen(p.name)}
                      >
                        <span className="project-name">{p.name}</span>
                        <span className="project-date">{formatDate(p.createdAt, locale)}</span>
                        <span className={`badge${p.hasPuml ? ' badge-ok' : ''}`}>
                          {p.hasPuml ? t('start.withPuml') : t('start.withoutPuml')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => goTo('choose')} disabled={busy}>
                  {t('start.back')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
