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
import { CloseConfirmModal } from './components/CloseConfirmModal';
import { DropOverlay, type DropPhase } from './components/DropOverlay';
import { useTheme } from './components/useTheme';
import { useI18n } from './i18n/I18nProvider';

const api = window.autouml;

interface ModalState {
  open: boolean;
  dismissable: boolean;
}

function hasFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes('Files');
}

export default function App() {
  const { t, locale, setLocale } = useI18n();
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
  const loadedFor = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(true);
  // Fuerza re-parseo en recarga.
  const [sourceTick, setSourceTick] = useState(0);
  const canvasRef = useRef<DiagramCanvasHandle | null>(null);
  const [externalName, setExternalName] = useState<string | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const dropBusy = useRef(false);

  // Feedback visual de drag and drop.
  const [dropPhase, setDropPhase] = useState<DropPhase>('idle');
  const dragDepth = useRef(0);
  const tRef = useRef(t);
  const handleRelayoutRef = useRef<() => void>(() => undefined);

  // Confirmación de cierre.
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [closeSaving, setCloseSaving] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeSaveProjectPending, setCloseSaveProjectPending] = useState(false);
  const closeSaveSourceRef = useRef<string | null>(null);
  const diagramRef = useRef<DiagramModel | null>(null);

  const docName = externalName
    ? externalName.replace(/\.[^.]+$/, '')
    : project?.meta.name ?? t('app.diagram');

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    diagramRef.current = diagram;
  }, [diagram]);

  useEffect(() => {
    void api.getStorageInfo().then(setStorage);
  }, []);

  useEffect(() => {
    const currentName = externalName?.replace(/\.[^.]+$/, '') ?? project?.meta.name;
    document.title = currentName ? currentName + ' — AutoUML' : 'AutoUML';
  }, [project, externalName]);

  useEffect(() => {
    const onSettingsShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'L' || event.key === 'l')) {
        event.preventDefault();
        handleRelayoutRef.current();
      }
    };
    window.addEventListener('keydown', onSettingsShortcut);
    return () => window.removeEventListener('keydown', onSettingsShortcut);
  }, []);

  // Solicitud de cierre desde main: ACK inmediato y, solo si hay diagrama, se pregunta.
  useEffect(() => api.onCloseRequested(() => {
    api.confirmClose('acknowledged');
    if (diagramRef.current === null) {
      api.confirmClose('close');
      return;
    }
    setCloseError(null);
    setClosePromptOpen(true);
  }), []);

  // Sincroniza qué opciones del menú nativo están habilitadas.
  // hasPuml también cuenta el diagrama externo soltado (sin proyecto) para zoom/fit/export/sidebar.
  useEffect(() => {
    api.updateMenuState({
      projectOpen: project !== null,
      hasPuml: project?.puml != null || diagram !== null,
      sidebarVisible,
      locale,
      themeMode,
    });
  }, [project, diagram, sidebarVisible, locale, themeMode]);

  // Los mensajes que no son de error se ocultan solos.
  useEffect(() => {
    if (!status || status.kind === 'error') return;
    const t = window.setTimeout(() => setStatus(null), 5000);
    return () => window.clearTimeout(t);
  }, [status]);

  // Lee el .puml del disco y lo parsea en el renderer. No tumba la app si falla.
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

  // Ruta global única de drop. El overlay solo refleja la fase; nunca recibe eventos.
  useEffect(() => {
    let mounted = true;

    const resetDrag = () => {
      dragDepth.current = 0;
      if (mounted && !dropBusy.current) setDropPhase('idle');
    };

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      if (!dropBusy.current) setDropPhase('dragging');
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (event: DragEvent) => {
      // relatedTarget null = el puntero salió de la ventana.
      if (event.relatedTarget === null) {
        resetDrag();
        return;
      }
      dragDepth.current = Math.max(0, dragDepth.current - 1);
    };
    const onDragEnd = () => resetDrag();
    const onBlur = () => resetDrag();

    const onDrop = (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0 && !hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      dragDepth.current = 0;
      if (dropBusy.current) return;
      if (files.length === 0) {
        setDropPhase('idle');
        return;
      }
      const translateNow = tRef.current;
      dropBusy.current = true;
      setDropPhase('opening');
      void openDroppedFiles(files, api.openDroppedPuml, translateNow)
        .then((outcome) => {
          if (!mounted) return;
          if (outcome.status) setStatus(outcome.status);
          if (outcome.opened) handlePumlOpened(outcome.opened);
          if (outcome.refresh) setHistoryTick((tick) => tick + 1);
        })
        .catch((error: unknown) => {
          if (!mounted) return;
          setStatus({ kind: 'error', text: error instanceof Error ? error.message : translateNow('status.dropFailed') });
        })
        .finally(() => {
          dropBusy.current = false;
          dragDepth.current = 0;
          if (mounted) setDropPhase('idle');
        });
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragend', onDragEnd);
    window.addEventListener('drop', onDrop);
    window.addEventListener('blur', onBlur);
    return () => {
      mounted = false;
      dragDepth.current = 0;
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragend', onDragEnd);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('blur', onBlur);
    };
  }, [handlePumlOpened]);

  // Carga inicial del texto cuando el proyecto pasa a tener .puml.
  // No borra un diagrama externo soltado: ese vive sin proyecto.
  useEffect(() => {
    if (!project?.puml) {
      loadedFor.current = null;
      if (externalName) return;
      setSource(null);
      setDiagram(null);
      setSelectedId(null);
      return;
    }
    const key = project.meta.name + ':' + (project.meta.pumlLoadedAt ?? '');
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
  const handleRelayout = useCallback(() => {
    if (!canvasRef.current) return;
    canvasRef.current.resetLayout();
    setStatus({ kind: 'info', text: t('status.relayout') });
  }, [t]);
  handleRelayoutRef.current = handleRelayout;
  const handleExport = useCallback(async () => {
    const handle = canvasRef.current;
    if (!handle) return;
    const blob = await handle.exportPng();
    if (!blob) {
      setStatus({ kind: 'error', text: t('status.noDiagramToExport') });
      return;
    }
    const result = await api.savePng(docName + '.png', new Uint8Array(await blob.arrayBuffer()));
    if (!result.ok) setStatus({ kind: 'error', text: result.error });
    else if (result.value) setStatus({ kind: 'success', text: t('status.pngSaved', { path: result.value }) });
  }, [docName, t]);

  const saveCloseSourceToProject = useCallback(async (target: ProjectInfo, text: string) => {
    const keepDisplayedDiagram = () => {
      setProject(target);
      if (externalName) {
        loadedFor.current = target.puml ? target.meta.name + ':' + (target.meta.pumlLoadedAt ?? '') : null;
        setSource(text);
        setDiagram(parsePuml(text));
      } else {
        setExternalName(null);
      }
    };
    setCloseSaving(true);
    setCloseError(null);
    try {
      const r = await api.savePumlToProject(target.meta.name, text);
      if (!r.ok) {
        setCloseError(r.error);
        keepDisplayedDiagram();
        setClosePromptOpen(true);
        return;
      }
      if (r.value.status === 'cancelled') {
        keepDisplayedDiagram();
        setCloseError(t('close.replaceCancelled'));
        setClosePromptOpen(true);
        return;
      }
      setProject(r.value.project);
      setExternalName(null);
      setClosePromptOpen(false);
      api.confirmClose('close');
    } catch (error: unknown) {
      keepDisplayedDiagram();
      setCloseError(error instanceof Error ? error.message : t('close.saveFailed'));
      setClosePromptOpen(true);
    } finally {
      setCloseSaving(false);
    }
  }, [externalName, t]);

  // Guarda el diagrama como diagram.puml en el proyecto. Si aún no hay proyecto,
  // primero permite elegir uno existente o crear uno nuevo.
  const handleCloseSave = useCallback(() => {
    if (closeSaving) return;
    if (source === null) {
      setCloseError(t('history.noCurrentPuml'));
      return;
    }
    if (!project) {
      closeSaveSourceRef.current = source;
      setCloseSaveProjectPending(true);
      setClosePromptOpen(false);
      setModal({ open: true, dismissable: true });
      return;
    }
    void saveCloseSourceToProject(project, source);
  }, [closeSaving, source, project, saveCloseSourceToProject, t]);

  const handleStartModalOpened = useCallback((opened: ProjectInfo) => {
    if (!closeSaveProjectPending) {
      onProjectOpened(opened);
      return;
    }
    const text = closeSaveSourceRef.current;
    closeSaveSourceRef.current = null;
    setCloseSaveProjectPending(false);
    setModal({ open: false, dismissable: true });
    setClosePromptOpen(true);
    if (text === null) {
      setProject(opened);
      setCloseError(t('close.saveFailed'));
      setClosePromptOpen(true);
      return;
    }
    void saveCloseSourceToProject(opened, text);
  }, [closeSaveProjectPending, onProjectOpened, saveCloseSourceToProject, t]);

  const handleStartModalClose = useCallback(() => {
    setModal({ open: false, dismissable: true });
    if (!closeSaveProjectPending) return;
    closeSaveSourceRef.current = null;
    setCloseSaveProjectPending(false);
    setClosePromptOpen(true);
  }, [closeSaveProjectPending]);

  const handleCloseDiscard = useCallback(() => {
    setClosePromptOpen(false);
    api.confirmClose('close');
  }, []);

  const handleCloseCancel = useCallback(() => {
    setClosePromptOpen(false);
    setCloseError(null);
    api.confirmClose('cancel');
  }, []);

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
    // Internos + externos + sin declarar.
    const totalTypes = diagram.types.length;
    const warnings = diagram.issues.filter((i) => i.severity === 'warning').length;
    return t('status.summary', { types: totalTypes, relationships: diagram.relationships.length, warnings });
  }, [diagram, t]);

  // Despachador de las acciones del menú nativo (los atajos llegan por aquí).
  // toggle-sidebar y acciones de vista también funcionan con un .puml externo sin proyecto.
  const actionRef = useRef<(a: MenuAction) => void>(() => undefined);
  useEffect(() => {
    actionRef.current = (action) => {
      if (closePromptOpen) return;
      if (action === 'new-project' || action === 'open-project') {
        setModal({ open: true, dismissable: project !== null || diagram !== null });
        return;
      }
      if (action === 'toggle-sidebar') {
        if (modal.open) return;
        toggleSidebar();
        return;
      }
      if (action === 'settings-more') {
        setSettingsOpen(true);
        return;
      }
      if (action === 'theme-system' || action === 'theme-light' || action === 'theme-dark') {
        setThemeMode(action.slice('theme-'.length) as 'system' | 'light' | 'dark');
        return;
      }
      if (action === 'locale-es' || action === 'locale-en') {
        setLocale(action === 'locale-es' ? 'es' : 'en');
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
  }, [project, diagram, modal.open, closePromptOpen, handleLoad, handleReload, toggleSidebar, handleZoomIn, handleZoomOut, handleFit, handleExport, setThemeMode, setLocale, t]);

  useEffect(() => api.onMenuAction((a) => actionRef.current(a)), []);

  const headerName = project?.meta.name ?? externalName?.replace(/\.[^.]+$/, '') ?? null;

  return (
    <div className="app">
      {storage?.warning && <div className="banner banner-warning">⚠ {storage.warning}</div>}
      <Header
        projectName={headerName}
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
        onRelayout={handleRelayout}
        onExport={() => void handleExport()}
      />
      <div className="workspace" aria-busy={dropPhase === 'opening'}>
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
          suggestedName={docName + '.puml'}
          refreshKey={historyTick}
          onOpened={handlePumlOpened}
          onStatus={setStatus}
        />
        <DropOverlay phase={dropPhase} />
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
          onClose={handleStartModalClose}
          onOpened={handleStartModalOpened}
        />
      )}
      {settingsOpen && <SettingsDialog themeMode={themeMode} onThemeChange={setThemeMode} onClose={() => setSettingsOpen(false)} />}
      {closePromptOpen && (
        <CloseConfirmModal
          saving={closeSaving}
          error={closeError}
          onSave={() => void handleCloseSave()}
          onDiscard={handleCloseDiscard}
          onCancel={handleCloseCancel}
        />
      )}
    </div>
  );
}
