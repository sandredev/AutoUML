import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import type { ProjectInfo, ProjectSummary } from '../../shared/ipc';
import { MAX_PROJECT_NAME_LENGTH, validateProjectName } from '../../shared/validation';
import { CloseIcon, FolderIcon, PlusIcon } from './Icons';

type View = 'choose' | 'new' | 'list';

interface Props {
  dismissable: boolean;
  onClose: () => void;
  onOpened: (project: ProjectInfo) => void;
}

const api = window.autouml;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function StartModal({ dismissable, onClose, onOpened }: Props): JSX.Element {
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

  const title = view === 'choose' ? 'AutoUML' : view === 'new' ? 'Nuevo proyecto' : 'Cargar proyecto';

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
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar" title="Cerrar (Esc)">
              <CloseIcon />
            </button>
          )}
        </div>

        <div className="modal-body" ref={bodyRef}>
          {view === 'choose' && (
            <>
              <p className="modal-subtitle">Cada proyecto contiene exactamente un archivo .puml.</p>
              <div className="choice-grid">
                <button type="button" className="choice-btn" onClick={() => goTo('list')}>
                  <FolderIcon />
                  <span className="choice-label">CARGAR</span>
                  <span className="choice-hint">Abrir un proyecto existente</span>
                </button>
                <button type="button" className="choice-btn" onClick={() => goTo('new')}>
                  <PlusIcon />
                  <span className="choice-label">NUEVO</span>
                  <span className="choice-hint">Crear un proyecto vacío</span>
                </button>
              </div>
            </>
          )}

          {view === 'new' && (
            <form onSubmit={(e) => void handleCreate(e)} noValidate>
              <label className="field-label" htmlFor="project-name">
                Nombre del proyecto
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
                {showNameError ? nameError : serverError ?? 'Se creará una carpeta con este nombre.'}
              </p>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => goTo('choose')} disabled={busy}>
                  Volver
                </button>
                <button type="submit" className="btn btn-primary" disabled={nameError !== null || busy}>
                  {busy ? 'Creando…' : 'Crear'}
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
              {!listLoaded && <p className="muted">Cargando proyectos…</p>}
              {listLoaded && projects.length === 0 && (
                <div className="empty-list">
                  <p>No hay proyectos todavía</p>
                  <button type="button" className="btn btn-primary" onClick={() => goTo('new')}>
                    Crear uno nuevo
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
                        <span className="project-date">{formatDate(p.createdAt)}</span>
                        <span className={`badge${p.hasPuml ? ' badge-ok' : ''}`}>
                          {p.hasPuml ? 'con .puml' : 'sin .puml'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => goTo('choose')} disabled={busy}>
                  Volver
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
