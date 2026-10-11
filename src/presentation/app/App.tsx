import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MenuAction, MenuState, ProjectInfo, PumlScope, SidecarState, StorageInfo } from '../../application/ports/ipc';
import type { OpenPumlFile } from '../../application/ports/history';
import { buildTree, countByCategory } from '../../domain/diagram/classify';
import { parsePuml } from '../../application/puml/parser';
import type { DiagramModel } from '../../domain/diagram/model';
import { Header } from '../components/Header';
import { HistoryPanel, openDroppedFiles } from '../components/HistoryPanel';
import { IssuesPanel } from '../components/IssuesPanel';
import { RenderArea } from '../components/RenderArea';
import { Sidebar } from '../components/Sidebar';
import { StartModal } from '../components/StartModal';
import { StatusBar, type Status } from '../components/StatusBar';
import type { DiagramCanvasHandle } from '../diagram/canvas/DiagramCanvas';
import { SettingsDialog } from '../components/SettingsDialog';
import { CloseConfirmModal } from '../components/CloseConfirmModal';
import { DropOverlay, type DropPhase } from '../components/DropOverlay';
import { LoadingIntro } from '../components/LoadingIntro';
import { isIntroActive } from '../components/introState';
import { useTheme } from '../components/useTheme';
import { isThemeMode } from '../../domain/rules/themes';
import { useLocalization } from '../localization/LocalizationProvider';

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
  const { t, locale, setLocale } = useLocalization();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [modal, setModal] = useState<ModalState>({ open: true, dismissable: false });
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [layoutLoading, setLayoutLoading] = useState(false);

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
  // T5: scope actual (proyecto o externo) para el watch y el sidecar.
  const scopeRef = useRef<PumlScope | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const pendingCollapsed = useRef<ReadonlySet<string> | null>(null);
  // T5: texto combinado (con !include expandidos, lo que se parsea y muestra IssuesPanel),
  // archivos vigilados, ruta externa y sidecar.
  const [combined, setCombined] = useState<string | null>(null);
  const [sourceFiles, setSourceFiles] = useState<string[]>([]);
  const [externalPath, setExternalPath] = useState<string | null>(null);
  const [initialSidecar, setInitialSidecar] = useState<SidecarState | null | undefined>(undefined);

  // Feedback visual de drag and drop.
  const [dropPhase, setDropPhase] = useState<DropPhase>('idle');
  const dragDepth = useRef(0);
  const tRef = useRef(t);
  const handleRelayoutRef = useRef<() => void>(() => undefined);
  const handleCopyPngRef = useRef<() => void>(() => undefined);

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

  // Mismo docKey ⇒ mismo documento: una recarga conserva la vista y las posiciones manuales.
  const docKey = externalName ? 'file:' + externalName : project ? 'project:' + project.meta.name : undefined;
  scopeRef.current = project ? { project: project.meta.name } : externalPath ? { file: externalPath } : null;

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
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'C' || event.key === 'c')) {
        event.preventDefault();
        void handleCopyPngRef.current();
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
  const menuState = useMemo<MenuState>(
    () => ({ projectOpen: project !== null, hasPuml: project?.puml != null || diagram !== null, sidebarVisible, locale, themeMode }),
    [project, diagram, sidebarVisible, locale, themeMode],
  );
  useEffect(() => {
    api.updateMenuState(menuState);
  }, [menuState]);

  // Los mensajes que no son de error se ocultan solos.
  useEffect(() => {
    if (!status || status.kind === 'error') return;
    const t = window.setTimeout(() => setStatus(null), 5000);
    return () => window.clearTimeout(t);
  }, [status]);

  // Carga el documento con sus !include resueltos (proyecto o externo) y lo parsea.
  // source sigue siendo el texto crudo de entrada (los guardados quedan intactos);
  // combined es lo parseado (IssuesPanel lo usa para el snippet). No tumba la app si falla.
  const loadDocument = useCallback(async (scope: PumlScope, opts?: { silent?: boolean }): Promise<boolean> => {
    const silent = opts?.silent ?? false;
    if (!silent) setSourceLoading(true);
    try {
      const r = await api.loadSource(scope);
      if (!r.ok) {
        if (!silent) {
          setSource(null);
          setCombined(null);
          setSourceFiles([]);
          setDiagram(null);
          setStatus({ kind: 'error', text: r.error });
        }
        return false;
      }
      const { entryText, combined: text, files, lineMap, loadIssues } = r.value;
      const model = parsePuml(text);
      // Los issues del parser van en líneas del combinado: se remapean al origen
      // (line+file) y guardan la línea combinada para el snippet.
      const remapped = model.issues.map((issue) => {
        const ref = lineMap[issue.line - 1];
        if (!ref) return issue;
        return { ...issue, file: ref.file, line: ref.line, combinedLine: issue.line };
      });
      // Los del loader ya traen file+line de origen (sin línea combinada).
      const loaderIssues = loadIssues.map((i) => ({ line: i.line, severity: i.severity, message: i.message, file: i.file }));
      setSource(entryText);
      setCombined(text);
      setSourceFiles(files);
      setDiagram({ ...model, issues: [...loaderIssues, ...remapped] });
      setSourceTick((t) => t + 1);
      return true;
    } finally {
      if (!silent) setSourceLoading(false);
    }
  }, []);

  const handlePumlOpened = useCallback((file: OpenPumlFile) => {
    setSelectedId(null);
    setExternalName(file.entry.name);
    setExternalPath(file.entry.path);
    setModal((current) => current.open ? { open: false, dismissable: true } : current);
    void loadDocument({ file: file.entry.path });
  }, [loadDocument]);

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
      setCombined(null);
      setSourceFiles([]);
      setDiagram(null);
      setSelectedId(null);
      return;
    }
    const key = project.meta.name + ':' + (project.meta.pumlLoadedAt ?? '');
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    setExternalName(null);
    setExternalPath(null);
    void loadDocument({ project: project.meta.name });
  }, [project, externalName, loadDocument]);

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
      // El contenido manda (con !include resueltos); los metadatos se refrescan después
      // sin disparar la carga inicial (loadedFor ya queda al día).
      const ok = await loadDocument({ project: project.meta.name });
      const meta = await api.reloadPuml(project.meta.name);
      if (meta.ok) {
        setProject(meta.value);
        loadedFor.current = meta.value.meta.name + ':' + (meta.value.meta.pumlLoadedAt ?? '');
      }
      setStatus(
        ok
          ? { kind: 'success', text: t('status.reloaded') }
          : { kind: 'error', text: t('status.reloadFailed') },
      );
    } finally {
      setBusy(false);
    }
  }, [project, busy, loadDocument, t]);

  // T5.1: vigila la entrada + los incluidos; al cambiar, recarga silenciosa por el
  // mismo flujo (sin busy; la vista se conserva por docKey). Al borrar, aviso sin crash.
  const filesKey = sourceFiles.join('\n');
  useEffect(() => {
    if (sourceFiles.length === 0) return;
    let cancelled = false;
    void api.watchPumlFiles(sourceFiles).then((r) => {
      if (!r.ok && !cancelled) setStatus({ kind: 'error', text: r.error });
    });
    return () => {
      cancelled = true;
      api.unwatchPumlFiles();
    };
    // filesKey estabiliza la dep: el mismo contenido no revigila.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey]);

  useEffect(() => api.onPumlFilesChanged((event) => {
    if (event.kind === 'removed') {
      setStatus({ kind: 'error', text: tRef.current('status.externalRemoved') });
      api.unwatchPumlFiles();
      return;
    }
    const scope = scopeRef.current;
    if (!scope) return;
    void loadDocument(scope, { silent: true }).then((ok) => {
      if (ok) setStatus({ kind: 'success', text: tRef.current('status.externalChanged') });
    });
  }), [loadDocument]);

  // T5.3: el sidecar se carga por documento; lo que cambie (colapsados, posiciones,
  // vista) se guarda con debounce de ~800 ms.
  useEffect(() => {
    setInitialSidecar(undefined);
    if (docKey === undefined) return;
    const scope: PumlScope | null = project ? { project: project.meta.name } : externalPath ? { file: externalPath } : null;
    if (scope === null) return;
    let cancelled = false;
    void api.loadSidecar(scope).then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setInitialSidecar(null);
        return;
      }
      if (r.value.corrupt) setStatus({ kind: 'info', text: tRef.current('status.sidecarCorrupt') });
      setInitialSidecar(r.value.state);
    });
    return () => {
      cancelled = true;
    };
  }, [docKey, project, externalPath]);

  const handleViewStateChange = useCallback((_collapsed: ReadonlySet<string>) => {
    pendingCollapsed.current = _collapsed;
    if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = undefined;
      const handle = canvasRef.current;
      const scope = scopeRef.current;
      if (!handle || !scope) return;
      const snap = handle.getSnapshot();
      void api.saveSidecar(scope, {
        version: 1,
        collapsed: [...(pendingCollapsed.current ?? [])],
        overrides: snap.overrides,
        view: snap.view,
      });
    }, 800);
  }, []);

  useEffect(() => () => {
    if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current);
  }, []);

  const onProjectOpened = useCallback((p: ProjectInfo) => {
    setProject(p);
    setExternalName(null);
    setExternalPath(null);
    setModal({ open: false, dismissable: true });
    setStatus({ kind: 'info', text: t('status.projectOpened', { name: p.meta.name }) });
  }, [t]);

  const toggleSidebar = useCallback(() => setSidebarVisible((v) => !v), []);

  const handleNewProject = useCallback(() => {
    setModal({ open: true, dismissable: project !== null || diagram !== null });
  }, [project, diagram]);

  // handleStartModalOpened usa setModal({open:false}) al crear/abrir, así que
  // el estado vacío desaparece solo cuando hay proyecto o diagrama.

  const handleZoomIn = useCallback(() => canvasRef.current?.zoomIn(), []);
  const handleZoomOut = useCallback(() => canvasRef.current?.zoomOut(), []);
  const handleFit = useCallback(() => canvasRef.current?.fit(), []);
  const handleRelayout = useCallback(() => {
    if (!canvasRef.current) return;
    canvasRef.current.resetPositions();
    canvasRef.current.fit();
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

  const handleExportSvg = useCallback(async () => {
    const handle = canvasRef.current;
    if (!handle) return;
    const data = handle.exportSvg();
    if (!data) {
      setStatus({ kind: 'error', text: t('status.noDiagramToExport') });
      return;
    }
    const result = await api.saveSvg(docName + '.svg', data.svg);
    if (!result.ok) setStatus({ kind: 'error', text: result.error });
    else if (result.value) setStatus({ kind: 'success', text: t('status.svgSaved', { path: result.value }) });
  }, [docName, t]);

  const handleExportPdf = useCallback(async () => {
    const handle = canvasRef.current;
    if (!handle) return;
    const data = handle.exportSvg();
    if (!data) {
      setStatus({ kind: 'error', text: t('status.noDiagramToExport') });
      return;
    }
    const result = await api.savePdf(docName + '.pdf', data.svg, data.width, data.height);
    if (!result.ok) setStatus({ kind: 'error', text: result.error });
    else if (result.value) setStatus({ kind: 'success', text: t('status.pdfSaved', { path: result.value }) });
  }, [docName, t]);

  const handleCopyPng = useCallback(async () => {
    const handle = canvasRef.current;
    if (!handle) return;
    const blob = await handle.exportPngFull({ scale: 2, theme: 'light' });
    if (!blob) {
      setStatus({ kind: 'error', text: t('status.noDiagramToExport') });
      return;
    }
    const result = await api.writePngToClipboard(new Uint8Array(await blob.arrayBuffer()));
    if (!result.ok) setStatus({ kind: 'error', text: result.error });
    else setStatus({ kind: 'success', text: t('status.pngCopied') });
  }, [t]);
  handleCopyPngRef.current = handleCopyPng;

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
      if (action.startsWith('theme-')) {
        const next = action.slice('theme-'.length);
        if (isThemeMode(next)) setThemeMode(next);
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
          // Acción de menú/teclado (Ctrl+0): se repite mucho, sin animación. El botón del header sí anima.
          canvasRef.current?.fit({ animate: false });
          break;
        case 'export':
          void handleExport();
          break;
        case 'export-svg':
          void handleExportSvg();
          break;
        case 'export-pdf':
          void handleExportPdf();
          break;
        case 'copy-png':
          void handleCopyPng();
          break;
      }
    };
  }, [project, diagram, modal.open, closePromptOpen, handleLoad, handleReload, toggleSidebar, handleZoomIn, handleZoomOut, handleExport, handleExportSvg, handleExportPdf, handleCopyPng, setThemeMode, setLocale, t]);

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
        menuState={menuState}
        onMenuAction={(a) => actionRef.current(a)}
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
          onLayoutLoadingChange={setLayoutLoading}
          onNewProject={handleNewProject}
          onOpenProject={handleNewProject}
          {...(docKey !== undefined ? { docKey } : {})}
          {...(initialSidecar !== undefined ? { initialSidecar } : {})}
          onViewStateChange={handleViewStateChange}
        >
          <LoadingIntro
            active={isIntroActive({ booting: storage === null, documentLoading: sourceLoading, layoutLoading })}
          />
        </RenderArea>
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
        source={combined}
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
