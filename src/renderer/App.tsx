import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MenuAction, ProjectInfo, StorageInfo } from '../shared/ipc';
import type { OpenPumlFile } from '../shared/history';
import { buildTree, countByCategory } from '../core/classify';
import { parsePuml } from '../core/parser';
import type { DiagramModel } from '../core/model';
import { Header } from './components/Header';
import { HistoryPanel, openDroppedFiles } from './components/HistoryPanel';
import { IssuesPanel } from './components/IssuesPanel';
import { RenderArea } from './components/RenderArea';
import { Sidebar } from './components/Sidebar';
import { StartModal } from './components/StartModal';
import { StatusBar, type Status } from './components/StatusBar';
import type { DiagramCanvasHandle } from '../render/canvas/DiagramCanvas';
import { SettingsDialog } from './components/SettingsDialog';
import { useTheme } from './components/useTheme';
import { useI18n } from './i18n/I18nProvider';

const api = window.autouml;

interface ModalState {
  open: boolean;
  dismissable: boolean;
}

export default function App() {
  const { t, locale } = useI18n();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [modal, setModal] = useState<ModalState>({ open: true, dismissable: true });
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  // Sesión 3
  const [source, setSource] = useState<string | null>(null);
  const [diagram, setDiagram] = useState<DiagramModel | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(true);
  const [sourceTick, setSourceTick] = useState(0); // fuerza re-parseo en recarga
  const canvasRef = useRef<DiagramCanvasHandle | null>(null);
  const [externalName, setExternalName] = useState<string | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const dropBusy = useRef(false);
  const docName = externalName
    ? externalName.replace(/\.[^.]+$/, '')
    : project?.meta.name ?? t('app.diagram');

  useEffect(() => {
    void api.getStorageInfo().then(setStorage);
  }, []);

  useEffect(() => {
    const currentName = externalName?.replace(/\.[^.]+$/, '') ?? project?.meta.name;
    document.title = currentName ? `${currentName} — AutoUML` : 'AutoUML';
  }, [project, externalName]);

  useEffect(() => {
    const onSettingsShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', onSettingsShortcut);
    return () => window.removeEventListener('keydown', onSettingsShortcut);
  }, []);

  // Sincroniza qué opciones del menú nativo están habilitadas.
  // hasPuml también cuenta el diagrama externo soltado (sin proyecto) para zoom/fit/export/sidebar.
  useEffect(() => {
    api.updateMenuState({
      projectOpen: project !== null,
      hasPuml: project?.puml != null || diagram !== null,
      sidebarVisible,
      locale,
    });
  }, [project, diagram, sidebarVisible, locale]);

  // Los mensajes que no son de error se ocultan solos.
  useEffect(() => {
    if (!status || status.kind === 'error') return;
    const t = window.setTimeout(() => setStatus(null), 5000);
    return () => window.clearTimeout(t);
  }, [status]);

  /** Lee el .puml del disco y lo parsea en el renderer. No tumba la app si falla. */
  const loadSource = useCallback(async (projectName: string): Promise<boolean> => {
    const r = await api.readPuml(projectName);
    if (!r.ok) {
      setSource(null);
      setDiagram(null);
      setStatus({ kind: 'error', text: r.error });
      return false;
    }
    setSource(r.value);
    setDiagram(parsePuml(r.value));
    setSourceTick((t) => t + 1);
    setExternalName(null);
    return true;
  }, []);

  const handlePumlOpened = useCallback((file: OpenPumlFile) => {
    setSource(file.source);
    setDiagram(parsePuml(file.source));
    setSourceTick((tick) => tick + 1);
    setSelectedId(null);
    setExternalName(file.entry.name);
    setModal((current) => current.open ? { open: false, dismissable: true } : current);
  }, []);

  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      if (dropBusy.current) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      dropBusy.current = true;
      void openDroppedFiles(files, api.openDroppedPuml, t)
        .then((outcome) => {
          if (outcome.status) setStatus(outcome.status);
          if (outcome.opened) handlePumlOpened(outcome.opened);
          if (outcome.refresh) setHistoryTick((tick) => tick + 1);
        })
        .catch((error: unknown) => {
          setStatus({ kind: 'error', text: error instanceof Error ? error.message : t('status.dropFailed') });
        })
        .finally(() => {
          dropBusy.current = false;
        });
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [handlePumlOpened, t]);

  // Carga inicial del texto cuando el proyecto pasa a tener .puml.
  // No borra un diagrama externo soltado: ese vive sin proyecto.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!project?.puml) {
      loadedFor.current = null;
      if (externalName) return;
      setSource(null);
      setDiagram(null);
      setSelectedId(null);
      return;
    }
    const key = `${project.meta.name}:${project.meta.pumlLoadedAt ?? ''}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    void loadSource(project.meta.name);
  }, [project, externalName, loadSource]);

  const handleLoad = useCallback(async () => {
    if (!project || busy) return;
    setBusy(true);
    try {
      const r = await api.loadPuml(project.meta.name);
      if (!r.ok) setStatus({ kind: 'error', text: r.error });
      else if (r.value.status === 'loaded') {
        setProject(r.value.project);
        setStatus({ kind: 'success', text: t('status.loaded', { name: r.value.project.puml?.originalFileName ?? '' }) });
      }
    } finally {
      setBusy(false);
    }
  }, [project, busy, t]);

  const handleReload = useCallback(async () => {
    if (!project?.puml || busy) return;
    setBusy(true);
    try {
      const r = await api.reloadPuml(project.meta.name);
      if (r.ok) {
        setProject(r.value);
        // Re-parseo aunque los metadatos no cambien: el texto pudo cambiar en disco.
        const ok = await loadSource(project.meta.name);
        setStatus(
          ok
            ? { kind: 'success', text: t('status.reloaded') }
            : { kind: 'error', text: t('status.reloadFailed') },
        );
      } else {
        setStatus({ kind: 'error', text: r.error });
      }
    } finally {
      setBusy(false);
    }
  }, [project, busy, loadSource, t]);

  const onProjectOpened = useCallback((p: ProjectInfo) => {
    setProject(p);
    setExternalName(null);
    setModal({ open: false, dismissable: true });
    setStatus({ kind: 'info', text: t('status.projectOpened', { name: p.meta.name }) });
  }, [t]);

  const toggleSidebar = useCallback(() => setSidebarVisible((v) => !v), []);

  const handleZoomIn = useCallback(() => canvasRef.current?.zoomIn(), []);
  const handleZoomOut = useCallback(() => canvasRef.current?.zoomOut(), []);
  const handleFit = useCallback(() => canvasRef.current?.fit(), []);
  const handleExport = useCallback(async () => {
    const handle = canvasRef.current;
    if (!handle) return;
    const blob = await handle.exportPng();
    if (!blob) {
      setStatus({ kind: 'error', text: t('status.noDiagramToExport') });
      return;
    }
    const result = await api.savePng(`${docName}.png`, new Uint8Array(await blob.arrayBuffer()));
    if (!result.ok) setStatus({ kind: 'error', text: result.error });
    else if (result.value) setStatus({ kind: 'success', text: t('status.pngSaved', { path: result.value }) });
  }, [docName, t]);

  const handleSidebarSelect = useCallback((id: string) => {
    setSelectedId(id);
    canvasRef.current?.focusNode(id);
  }, []);

  // Derivados del modelo.
  const groups = useMemo(() => (diagram ? buildTree(diagram) : []), [diagram]);
  const counts = useMemo(() => (diagram ? countByCategory(diagram) : null), [diagram]);

  // Conserva la selección tras recargar solo si el tipo sigue existiendo.
  useEffect(() => {
    if (!diagram || !selectedId) return;
    if (!diagram.types.some((t) => t.id === selectedId)) setSelectedId(null);
  }, [diagram, selectedId, sourceTick]);

  const summary = useMemo(() => {
    if (!diagram) return null;
    const totalTypes = diagram.types.length; // internos + externos + sin declarar
    const warnings = diagram.issues.filter((i) => i.severity === 'warning').length;
    return t('status.summary', { types: totalTypes, relationships: diagram.relationships.length, warnings });
  }, [diagram, t]);

  // Despachador de las acciones del menú nativo (los atajos llegan por aquí).
  // toggle-sidebar y acciones de vista también funcionan con un .puml externo sin proyecto.
  const actionRef = useRef<(a: MenuAction) => void>(() => undefined);
  useEffect(() => {
    actionRef.current = (action) => {
      if (action === 'new-project' || action === 'open-project') {
        setModal({ open: true, dismissable: project !== null || diagram !== null });
        return;
      }
      if (action === 'toggle-sidebar') {
        if (modal.open) return;
        toggleSidebar();
        return;
      }
      if (modal.open || (!project && !diagram)) return;
      switch (action) {
        case 'load-puml':
        case 'replace-puml':
          void handleLoad();
          break;
        case 'reload-puml':
          void handleReload();
          break;
        case 'copy-project-name':
          if (!project) return;
          setStatus({ kind: 'info', text: t('status.copied', { name: project.meta.name }) });
          break;
        case 'zoom-in':
          handleZoomIn();
          break;
        case 'zoom-out':
          handleZoomOut();
          break;
        case 'fit':
          handleFit();
          break;
        case 'export':
          void handleExport();
          break;
      }
    };
  }, [project, diagram, modal.open, handleLoad, handleReload, toggleSidebar, handleZoomIn, handleZoomOut, handleFit, handleExport, t]);

  useEffect(() => api.onMenuAction((a) => actionRef.current(a)), []);

  const headerName = project?.meta.name ?? externalName?.replace(/\.[^.]+$/, '') ?? null;

  return (
    <div className="app">
      {storage?.warning && <div className="banner banner-warning">⚠ {storage.warning}</div>}
      <Header
        projectName={headerName}
        settingsOpen={settingsOpen}
        onOpenSettings={() => setSettingsOpen(true)}
        canLoad={project !== null && !busy}
        canReload={project?.puml != null && !busy}
        sidebarVisible={sidebarVisible}
        onLoad={() => void handleLoad()}
        onReload={() => void handleReload()}
        canView={diagram !== null && diagram.types.length > 0}
        onToggleSidebar={toggleSidebar}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFit={handleFit}
        onExport={() => void handleExport()}
      />
      <div className="workspace">
        {sidebarVisible && (project || diagram) && (
          <Sidebar
            project={project}
            externalName={externalName}
            width={sidebarWidth}
            onResize={setSidebarWidth}
            groups={groups}
            counts={counts}
            selectedId={selectedId}
            onSelect={handleSidebarSelect}
          />
        )}
        <RenderArea
          project={project}
          model={diagram}
          selectedId={selectedId}
          onSelect={setSelectedId}
          canvasRef={canvasRef}
        />
        <HistoryPanel
          api={api.history}
          source={source}
          suggestedName={`${docName}.puml`}
          refreshKey={historyTick}
          onOpened={handlePumlOpened}
          onStatus={setStatus}
        />
      </div>
      <IssuesPanel
        issues={diagram?.issues ?? []}
        source={source}
        open={issuesOpen}
        onToggle={() => setIssuesOpen((v) => !v)}
      />
      <StatusBar status={status} storage={storage} summary={summary} onDismiss={() => setStatus(null)} />
      {modal.open && (
        <StartModal
          dismissable={modal.dismissable}
          onClose={() => setModal({ open: false, dismissable: true })}
          onOpened={onProjectOpened}
        />
      )}
      {settingsOpen && <SettingsDialog themeMode={themeMode} onThemeChange={setThemeMode} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
