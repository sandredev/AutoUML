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
import { useTheme } from './components/useTheme';
import type { DiagramCanvasHandle } from '../render/canvas/DiagramCanvas';

const api = window.autouml;

interface ModalState {
  open: boolean;
  dismissable: boolean;
}

export default function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [modal, setModal] = useState<ModalState>({ open: true, dismissable: true });
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const { mode: themeMode, cycle: cycleTheme } = useTheme();

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
    : project?.meta.name ?? 'diagrama';

  useEffect(() => {
    void api.getStorageInfo().then(setStorage);
  }, []);

  useEffect(() => {
    const currentName = externalName?.replace(/\.[^.]+$/, '') ?? project?.meta.name;
    document.title = currentName ? `${currentName} — AutoUML` : 'AutoUML';
  }, [project, externalName]);

  // Sincroniza qué opciones del menú nativo están habilitadas.
  useEffect(() => {
    api.updateMenuState({
      projectOpen: project !== null,
      hasPuml: project?.puml != null,
      sidebarVisible,
    });
  }, [project, sidebarVisible]);

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
      void openDroppedFiles(files, api.openDroppedPuml)
        .then((outcome) => {
          if (outcome.status) setStatus(outcome.status);
          if (outcome.opened) handlePumlOpened(outcome.opened);
          if (outcome.refresh) setHistoryTick((tick) => tick + 1);
        })
        .catch((error: unknown) => {
          setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'No se pudo abrir el archivo soltado.' });
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
  }, [handlePumlOpened]);

  // Carga inicial del texto cuando el proyecto pasa a tener .puml.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!project?.puml) {
      loadedFor.current = null;
      setSource(null);
      setDiagram(null);
      setSelectedId(null);
      return;
    }
    const key = `${project.meta.name}:${project.meta.pumlLoadedAt ?? ''}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    void loadSource(project.meta.name);
  }, [project, loadSource]);

  const handleLoad = useCallback(async () => {
    if (!project || busy) return;
    setBusy(true);
    try {
      const r = await api.loadPuml(project.meta.name);
      if (!r.ok) setStatus({ kind: 'error', text: r.error });
      else if (r.value.status === 'loaded') {
        setProject(r.value.project);
        setStatus({ kind: 'success', text: `Se cargó "${r.value.project.puml?.originalFileName ?? ''}".` });
      }
    } finally {
      setBusy(false);
    }
  }, [project, busy]);

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
            ? { kind: 'success', text: 'Se recargó diagram.puml desde el disco.' }
            : { kind: 'error', text: 'No se pudo leer diagram.puml tras la recarga.' },
        );
      } else {
        setStatus({ kind: 'error', text: r.error });
      }
    } finally {
      setBusy(false);
    }
  }, [project, busy, loadSource]);

  const onProjectOpened = useCallback((p: ProjectInfo) => {
    setProject(p);
    setExternalName(null);
    setModal({ open: false, dismissable: true });
    setStatus({ kind: 'info', text: `Proyecto "${p.meta.name}" abierto.` });
  }, []);

  const toggleSidebar = useCallback(() => setSidebarVisible((v) => !v), []);

  const handleZoomIn = useCallback(() => canvasRef.current?.zoomIn(), []);
  const handleZoomOut = useCallback(() => canvasRef.current?.zoomOut(), []);
  const handleFit = useCallback(() => canvasRef.current?.fit(), []);
  const handleExport = useCallback(async () => {
    const handle = canvasRef.current;
    if (!handle) return;
    const blob = await handle.exportPng();
    if (!blob) {
      setStatus({ kind: 'error', text: 'No hay diagrama para exportar.' });
      return;
    }
    const result = await api.savePng(`${docName}.png`, new Uint8Array(await blob.arrayBuffer()));
    if (!result.ok) setStatus({ kind: 'error', text: result.error });
    else if (result.value) setStatus({ kind: 'success', text: `PNG guardado en ${result.value}.` });
  }, [docName]);

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
    return `${totalTypes} tipos · ${diagram.relationships.length} relaciones · ${warnings} advertencias`;
  }, [diagram]);

  // Despachador de las acciones del menú nativo (los atajos llegan por aquí).
  const actionRef = useRef<(a: MenuAction) => void>(() => undefined);
  useEffect(() => {
    actionRef.current = (action) => {
      if (action === 'new-project' || action === 'open-project') {
        setModal({ open: true, dismissable: project !== null });
        return;
      }
      if (modal.open || !project) return;
      switch (action) {
        case 'load-puml':
        case 'replace-puml':
          void handleLoad();
          break;
        case 'reload-puml':
          void handleReload();
          break;
        case 'toggle-sidebar':
          toggleSidebar();
          break;
        case 'copy-project-name':
          setStatus({ kind: 'info', text: `Se copió "${project.meta.name}" al portapapeles.` });
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
  }, [project, modal.open, handleLoad, handleReload, toggleSidebar, handleZoomIn, handleZoomOut, handleFit, handleExport]);

  useEffect(() => api.onMenuAction((a) => actionRef.current(a)), []);

  return (
    <div className="app">
      {storage?.warning && <div className="banner banner-warning">⚠ {storage.warning}</div>}
      <Header
        projectName={project?.meta.name ?? null}
        canLoad={project !== null && !busy}
        canReload={project?.puml != null && !busy}
        sidebarVisible={sidebarVisible}
        themeMode={themeMode}
        onCycleTheme={cycleTheme}
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
        {sidebarVisible && project && (
          <Sidebar
            project={project}
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
    </div>
  );
}
