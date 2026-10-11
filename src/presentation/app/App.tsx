import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MenuAction, MenuState, ProjectInfo, PumlLineRef, PumlScope, SidecarFilters, SidecarState, StorageInfo } from '../../application/ports/ipc';
import type { OpenPumlFile } from '../../application/ports/history';
import { buildTree, countByCategory } from '../../domain/diagram/classify';
import { scanIncludes } from '../../application/puml/include';
import { nextLiveState, parseDocument, reconcileDiskText, type LiveState } from '../../application/puml/liveDocument';
import { parsePuml } from '../../application/puml/parser';
import { validateRename } from '../../application/puml/rename';
import { createSourceIndex, lineMapping, type LineMapping, type SourceIndex } from '../../application/puml/sourceSync';
import type { DiagramModel, ParseIssue } from '../../domain/diagram/model';
import type { CodeEditorHandle } from '../editor/CodeEditor';
import { createDebouncer, LIVE_PARSE_DELAY_MS } from '../editor/debounce';
import { EDITOR_DEFAULT_WIDTH } from '../editor/editorSize';
import { Header } from '../components/Header';
import { HistoryPanel, openDroppedFiles } from '../components/HistoryPanel';
import { IssuesPanel } from '../components/IssuesPanel';
import { RenderArea } from '../components/RenderArea';
import { Sidebar } from '../components/Sidebar';
import { StartModal } from '../components/StartModal';
import { StatusBar, type Status } from '../components/StatusBar';
import type { DiagramCanvasHandle } from '../diagram/canvas/DiagramCanvas';
import type { CodeTarget } from '../diagram/PumlViewer';
import { hasActiveFilters } from '../diagram/graph/filters';
import { SettingsDialog } from '../components/SettingsDialog';
import { CloseConfirmModal } from '../components/CloseConfirmModal';
import { createOpenGuard, type OpenChoice } from './openGuard';
import { DropOverlay, type DropPhase } from '../components/DropOverlay';
import { LoadingIntro } from '../components/LoadingIntro';
import { isIntroActive } from '../components/introState';
import { useTheme } from '../components/useTheme';
import { isThemeMode } from '../../domain/rules/themes';
import { useLocalization } from '../localization/LocalizationProvider';

const api = window.autouml;

// CodeMirror pesa ~350 kB: el editor va en su propio chunk y solo se carga cuando hay un documento abierto.
const CodeEditor = lazy(() => import('../editor/CodeEditor').then((m) => ({ default: m.CodeEditor })));

interface ModalState {
  open: boolean;
  dismissable: boolean;
}

/** Cómo se llega a cargar el documento desde disco (T7: decide qué pasa con el texto del editor). */
type LoadMode = 'open' | 'reload' | 'watch';

/** Sincronía editor ↔ diagrama del último texto parseado (T7). */
interface SyncInfo {
  index: SourceIndex;
  mapping: LineMapping;
  hasIncludes: boolean;
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
  const pendingFilters = useRef<SidecarFilters>({});
  // T5: texto combinado (con !include expandidos, lo que se parsea y muestra IssuesPanel),
  // archivos vigilados, ruta externa y sidecar.
  const [combined, setCombined] = useState<string | null>(null);
  const [sourceFiles, setSourceFiles] = useState<string[]>([]);
  const [externalPath, setExternalPath] = useState<string | null>(null);
  const [initialSidecar, setInitialSidecar] = useState<SidecarState | null | undefined>(undefined);

  // T7: editor en vivo. El texto vive en CodeMirror; aquí solo refs (cada tecla no re-renderiza la app).
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorWidth, setEditorWidth] = useState(EDITOR_DEFAULT_WIDTH);
  // Cambia al abrir otro documento: el editor se monta de nuevo (texto e historial limpios).
  const [docGen, setDocGen] = useState(0);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const handleSaveRef = useRef<() => Promise<boolean>>(async () => false);
  // Abrir otro documento con cambios sin guardar pregunta antes (mismo modal que el cierre).
  const [openPromptOpen, setOpenPromptOpen] = useState(false);
  const [openSaving, setOpenSaving] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openGuard] = useState(() => createOpenGuard({
    isDirty: () => dirtyRef.current,
    save: () => handleSaveRef.current(),
    onPrompt: () => {
      setOpenError(null);
      setOpenPromptOpen(true);
    },
    onSettled: () => setOpenPromptOpen(false),
  }));
  const [stale, setStale] = useState(false);
  const [hasIncludes, setHasIncludes] = useState(false);
  /** Issues del último texto parseado (con errores graves no son los del diagrama mostrado). */
  const [issues, setIssues] = useState<ParseIssue[]>([]);
  const [entryPath, setEntryPath] = useState<string | null>(null);
  /** Línea (numeración del modelo) de la relación en la que está el cursor del editor. */
  const [highlightLine, setHighlightLine] = useState<number | null>(null);
  const editorTextRef = useRef('');
  const savedTextRef = useRef('');
  const liveRef = useRef<LiveState | null>(null);
  const syncRef = useRef<SyncInfo | null>(null);
  const parseSeq = useRef(0);
  const savingRef = useRef(false);
  // Parseo en vivo con debounce; la función real (runLiveParse) se asigna más abajo.
  const runLiveParseRef = useRef<(text: string) => Promise<void>>(async () => undefined);
  const [liveParse] = useState(() => createDebouncer<string>((text) => void runLiveParseRef.current(text), LIVE_PARSE_DELAY_MS));
  useEffect(() => () => liveParse.cancel(), [liveParse]);

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
    () => ({
      projectOpen: project !== null,
      hasPuml: project?.puml != null || diagram !== null,
      sidebarVisible,
      editorVisible,
      dirty,
      locale,
      themeMode,
    }),
    [project, diagram, sidebarVisible, editorVisible, dirty, locale, themeMode],
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

  /** Texto ya parseado: diagrama (o el último válido si hay errores graves), issues y sincronía. (T7) */
  const applyParsed = useCallback(
    (parsed: DiagramModel, text: string, map: readonly PumlLineRef[] | null, entry: string | null) => {
      const next = nextLiveState(liveRef.current, parsed);
      liveRef.current = next;
      syncRef.current = { index: createSourceIndex(parsed), mapping: lineMapping(map, entry), hasIncludes: map !== null };
      setDiagram(next.shown);
      setIssues(next.issues);
      setStale(next.stale);
      setCombined(text);
      setHasIncludes(map !== null);
    },
    [],
  );

  // Carga el documento con sus !include resueltos (proyecto o externo) y lo parsea.
  // source es el texto de entrada (lo que se guarda); combined es lo parseado (IssuesPanel lo usa
  // para el snippet). No tumba la app si falla. Con el editor (T7), un cambio en disco no pisa
  // ediciones sin guardar ('watch' → conflicto) y abrir otro documento monta un editor nuevo.
  const loadDocument = useCallback(async (scope: PumlScope, mode: LoadMode = 'open'): Promise<boolean> => {
    const silent = mode === 'watch';
    if (!silent) setSourceLoading(true);
    try {
      const r = await api.loadSource(scope);
      if (!r.ok) {
        if (!silent) {
          liveRef.current = null;
          syncRef.current = null;
          setSource(null);
          setCombined(null);
          setSourceFiles([]);
          setDiagram(null);
          setIssues([]);
          setStatus({ kind: 'error', text: r.error });
        }
        return false;
      }
      const { entryPath: entry, entryText, combined: text, files, lineMap, loadIssues } = r.value;
      if (mode === 'watch') {
        const decision = reconcileDiskText({ editorText: editorTextRef.current, savedText: savedTextRef.current, diskText: entryText });
        if (decision === 'conflict') {
          setStatus({ kind: 'info', text: tRef.current('status.diskConflict') });
          return false;
        }
        if (decision === 'replace') editorRef.current?.reset(entryText);
      } else {
        // Lo que estuviera pendiente de parsear era del texto anterior.
        liveParse.cancel();
        if (mode === 'open') {
          liveRef.current = null;
          setDocGen((g) => g + 1);
        } else editorRef.current?.reset(entryText);
      }
      // Un parseo en vivo que siga en curso ya no corresponde a este texto.
      parseSeq.current++;
      editorTextRef.current = entryText;
      savedTextRef.current = entryText;
      setDirty(false);
      // Sin !include el texto combinado es la entrada tal cual: no hace falta traducir líneas.
      const map = scanIncludes(entryText).length > 0 ? lineMap : null;
      const parsed = map ? parseDocument(text, { lineMap, loadIssues }) : parseDocument(text);
      setSource(entryText);
      setEntryPath(entry);
      setSourceFiles(files);
      applyParsed(parsed, text, map, entry);
      setSourceTick((t) => t + 1);
      return true;
    } finally {
      if (!silent) setSourceLoading(false);
    }
  }, [applyParsed, liveParse]);

  // T7: parseo en vivo con debounce. Con !include, main combina el texto del editor con los incluidos.
  const runLiveParse = useCallback(async (text: string) => {
    const seq = ++parseSeq.current;
    if (scanIncludes(text).length === 0) {
      applyParsed(parseDocument(text), text, null, null);
      setSource(text);
      return;
    }
    const scope = scopeRef.current;
    if (!scope) return;
    const r = await api.combineSource(scope, text);
    if (seq !== parseSeq.current || !r.ok) return;
    const v = r.value;
    applyParsed(parseDocument(v.combined, { lineMap: v.lineMap, loadIssues: v.loadIssues }), v.combined, v.lineMap, v.entryPath);
    setSource(text);
    setSourceFiles(v.files);
  }, [applyParsed]);
  runLiveParseRef.current = runLiveParse;

  const handlePumlOpened = useCallback((file: OpenPumlFile) => {
    openGuard.request(() => {
      setSelectedId(null);
      setExternalName(file.entry.name);
      setExternalPath(file.entry.path);
      setModal((current) => current.open ? { open: false, dismissable: true } : current);
      void loadDocument({ file: file.entry.path }, 'open');
    });
  }, [loadDocument, openGuard]);

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
      // Sin documento no hay editor: se olvida lo pendiente y el "sin guardar".
      liveParse.cancel();
      liveRef.current = null;
      syncRef.current = null;
      setDirty(false);
      setIssues([]);
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
    void loadDocument({ project: project.meta.name }, 'open');
  }, [project, externalName, loadDocument, liveParse]);

  const loadPumlNow = useCallback(async () => {
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
  // Cargar/Reemplazar PUML sustituye el documento: con cambios sin guardar se pregunta antes del diálogo.
  const handleLoad = useCallback(() => {
    if (!project || busy) return;
    openGuard.request(() => void loadPumlNow());
  }, [project, busy, openGuard, loadPumlNow]);

  const handleReload = useCallback(async () => {
    if (!project?.puml || busy) return;
    setBusy(true);
    try {
      // El contenido manda (con !include resueltos); los metadatos se refrescan después
      // sin disparar la carga inicial (loadedFor ya queda al día).
      const ok = await loadDocument({ project: project.meta.name }, 'reload');
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
    void loadDocument(scope, 'watch').then((ok) => {
      if (ok) setStatus({ kind: 'success', text: tRef.current('status.externalChanged') });
    });
  }), [loadDocument]);

  // T5.3: el sidecar se carga por documento; lo que cambie (colapsados, posiciones,
  // vista) se guarda con debounce de ~800 ms.
  const projectName = project?.meta.name ?? null;
  useEffect(() => {
    setInitialSidecar(undefined);
    if (docKey === undefined) return;
    const scope: PumlScope | null = projectName !== null ? { project: projectName } : externalPath ? { file: externalPath } : null;
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
  }, [docKey, projectName, externalPath]);

  const handleViewStateChange = useCallback((_collapsed: ReadonlySet<string>, filters: SidecarFilters) => {
    pendingCollapsed.current = _collapsed;
    pendingFilters.current = filters;
    if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = undefined;
      const handle = canvasRef.current;
      const scope = scopeRef.current;
      if (!handle || !scope) return;
      const snap = handle.getSnapshot();
      const filters = pendingFilters.current;
      void api.saveSidecar(scope, {
        version: 1,
        collapsed: [...(pendingCollapsed.current ?? [])],
        overrides: snap.overrides,
        view: snap.view,
        // Sin filtros activos no se escribe el campo: el sidecar queda igual que antes de T8.
        ...(hasActiveFilters(filters) ? { filters } : {}),
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

  // ---------- T7: editor ----------
  const editorVisibleRef = useRef(editorVisible);
  editorVisibleRef.current = editorVisible;
  const entryPathRef = useRef(entryPath);
  entryPathRef.current = entryPath;
  const sourceFilesRef = useRef(sourceFiles);
  sourceFilesRef.current = sourceFiles;
  const editorFileName = externalName ?? project?.puml?.originalFileName ?? 'diagram.puml';
  const editorFileNameRef = useRef(editorFileName);
  editorFileNameRef.current = editorFileName;

  const handleEditorChange = useCallback((text: string) => {
    editorTextRef.current = text;
    setDirty(text !== savedTextRef.current);
    liveParse.schedule(text);
  }, [liveParse]);

  /** Ctrl+S: escribe el texto del editor en el .puml abierto (proyecto o archivo externo). */
  const handleSave = useCallback(async (): Promise<boolean> => {
    const scope = scopeRef.current;
    if (!scope || savingRef.current) return false;
    liveParse.flush();
    const text = editorTextRef.current;
    if (text === savedTextRef.current) return true;
    savingRef.current = true;
    try {
      const r = await api.saveSource(scope, text);
      if (!r.ok) {
        setStatus({ kind: 'error', text: tRef.current('status.saveFailed', { error: r.error }) });
        return false;
      }
      savedTextRef.current = text;
      setDirty(editorTextRef.current !== text);
      const saved = r.value.project;
      if (saved) {
        // Guardar cambia pumlLoadedAt: se marca como cargado para que no se vuelva a leer del disco.
        loadedFor.current = saved.meta.name + ':' + (saved.meta.pumlLoadedAt ?? '');
        setProject(saved);
      }
      // El guardado es atómico (temporal + rename): se vuelve a vigilar por si el watcher seguía el archivo viejo.
      if (sourceFilesRef.current.length > 0) void api.watchPumlFiles(sourceFilesRef.current);
      setStatus({ kind: 'success', text: tRef.current('status.saved', { name: editorFileNameRef.current }) });
      return true;
    } catch (error: unknown) {
      setStatus({ kind: 'error', text: tRef.current('status.saveFailed', { error: error instanceof Error ? error.message : String(error) }) });
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [liveParse]);
  handleSaveRef.current = handleSave;

  /** Respuesta del modal "abrir otro documento": Guardar escribe el .puml y abre; si falla, el modal sigue. */
  const handleOpenChoice = useCallback((choice: OpenChoice) => {
    if (choice !== 'save') {
      void openGuard.resolve(choice);
      return;
    }
    setOpenSaving(true);
    setOpenError(null);
    void openGuard.resolve('save').then((opened) => {
      setOpenSaving(false);
      if (!opened && openGuard.pending()) setOpenError(tRef.current('openDirty.saveFailed'));
    });
  }, [openGuard]);

  /** Salta en el editor a líneas del modelo (si vienen de un !include no están en el editor). */
  const revealInEditor = useCallback((line: number, endLine = line) => {
    const sync = syncRef.current;
    const editor = editorRef.current;
    if (!sync || !editor || !editorVisibleRef.current) return;
    const from = sync.mapping.toEntry(line);
    if (from === null) return;
    editor.revealLines(from, sync.mapping.toEntry(endLine) ?? from);
  }, []);

  const revealType = useCallback((id: string) => {
    const range = syncRef.current?.index.rangeOf(id);
    if (range) revealInEditor(range.line, range.endLine);
  }, [revealInEditor]);

  /** El cursor del editor entró en otra línea: se resalta su tipo o su relación en el diagrama. */
  const handleCursorLine = useCallback((line: number) => {
    const sync = syncRef.current;
    if (!sync) return;
    const at = sync.mapping.toCombined(line);
    const element = at === null ? null : sync.index.elementAt(at);
    setSelectedId(element?.kind === 'type' ? element.id : null);
    setHighlightLine(element?.kind === 'relation' ? element.line : null);
  }, []);

  const handleCanvasSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    setHighlightLine(null);
    if (id !== null) revealType(id);
  }, [revealType]);

  const handleRelationSelect = useCallback((line: number | null) => {
    setHighlightLine(line);
    if (line !== null) revealInEditor(line);
  }, [revealInEditor]);

  const handleIssueSelect = useCallback((issue: ParseIssue) => {
    // Los de un archivo incluido no están en el editor.
    if (issue.file !== undefined && issue.file !== entryPathRef.current) return;
    setEditorVisible(true);
    // Si el panel estaba oculto, CodeMirror mide al mostrarse: el salto va en el siguiente fotograma.
    requestAnimationFrame(() => {
      editorRef.current?.revealLines(issue.line);
      editorRef.current?.focus();
    });
  }, []);

  /** Doble clic en una tarjeta: reescribe el identificador y sus referencias en el editor (Ctrl+Z deshace). */
  const handleRename = useCallback((id: string, next: string): string | null => {
    const model = liveRef.current?.shown;
    if (!model || !editorRef.current) return null;
    if (syncRef.current?.hasIncludes) return tRef.current('rename.includes');
    const problem = validateRename(model, id, next);
    if (problem === 'unchanged') return null;
    if (problem !== null) return tRef.current(`rename.${problem}`, { name: next });
    editorRef.current.renameType(id, next);
    setSelectedId(next);
    setStatus({ kind: 'info', text: tRef.current('status.renamed', { from: id, to: next }) });
    return null;
  }, []);

  /** Menú contextual "Ir al código" (T8): abre el editor y salta al tipo o a la relación. */
  const handleGoToCode = useCallback((target: CodeTarget) => {
    setEditorVisible(true);
    // Si el panel estaba oculto, CodeMirror mide al mostrarse: el salto va en el siguiente fotograma.
    requestAnimationFrame(() => {
      if (target.kind === 'type') revealType(target.id);
      else revealInEditor(target.line);
      editorRef.current?.focus();
    });
  }, [revealType, revealInEditor]);

  /** Menú contextual "Copiar nombre" (T8). */
  const handleCopyText = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => setStatus({ kind: 'success', text: tRef.current('status.copied', { name: text }) }),
      (error: unknown) => setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) }),
    );
  }, []);

  const toggleEditor = useCallback(() => setEditorVisible((v) => !v), []);
  useEffect(() => {
    if (editorVisible) editorRef.current?.focus();
  }, [editorVisible]);

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
    if (dirtyRef.current && scopeRef.current) {
      setCloseSaving(true);
      setCloseError(null);
      void handleSave().then((ok) => {
        setCloseSaving(false);
        if (!ok) {
          setCloseError(t('close.saveFailed'));
          return;
        }
        setClosePromptOpen(false);
        api.confirmClose('close');
      });
      return;
    }
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
  }, [closeSaving, source, project, saveCloseSourceToProject, handleSave, t]);

  const handleStartModalOpened = useCallback((opened: ProjectInfo) => {
    if (!closeSaveProjectPending) {
      // Otro proyecto sustituye al documento abierto: con cambios sin guardar se pregunta antes.
      setModal({ open: false, dismissable: true });
      if (opened.meta.name === project?.meta.name && !externalName) onProjectOpened(opened);
      else openGuard.request(() => onProjectOpened(opened));
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
  }, [closeSaveProjectPending, onProjectOpened, saveCloseSourceToProject, project, externalName, openGuard, t]);

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
    setHighlightLine(null);
    canvasRef.current?.focusNode(id);
    revealType(id);
  }, [revealType]);

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
    const warnings = issues.filter((i) => i.severity === 'warning').length;
    return t('status.summary', { types: totalTypes, relationships: diagram.relationships.length, warnings });
  }, [diagram, issues, t]);

  // Despachador de las acciones del menú nativo (los atajos llegan por aquí).
  // toggle-sidebar y acciones de vista también funcionan con un .puml externo sin proyecto.
  const actionRef = useRef<(a: MenuAction) => void>(() => undefined);
  useEffect(() => {
    actionRef.current = (action) => {
      if (closePromptOpen || openPromptOpen) return;
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
          handleLoad();
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
        case 'save':
          void handleSave();
          break;
        case 'toggle-editor':
          if (source !== null) toggleEditor();
          break;
      }
    };
  }, [project, diagram, source, modal.open, closePromptOpen, openPromptOpen, handleLoad, handleReload, handleSave, toggleSidebar, toggleEditor, handleZoomIn, handleZoomOut, handleExport, handleExportSvg, handleExportPdf, handleCopyPng, setThemeMode, setLocale, t]);

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
        editorVisible={editorVisible}
        canEdit={source !== null}
        onToggleEditor={toggleEditor}
        onLoad={handleLoad}
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
        {source !== null && (project || diagram) && (
          <Suspense fallback={null}>
          <CodeEditor
            key={docGen}
            ref={editorRef}
            hidden={!editorVisible}
            initialText={source}
            issues={issues}
            entryFile={entryPath}
            fileName={editorFileName}
            width={editorWidth}
            onResize={setEditorWidth}
            dirty={dirty}
            stale={stale}
            hasIncludes={hasIncludes}
            onChange={handleEditorChange}
            onCursorLine={handleCursorLine}
            onSave={() => void handleSave()}
            onClose={() => setEditorVisible(false)}
          />
          </Suspense>
        )}
        <RenderArea
          project={project}
          model={diagram}
          selectedId={selectedId}
          onSelect={handleCanvasSelect}
          highlightLine={highlightLine}
          onRelationSelect={handleRelationSelect}
          onRename={handleRename}
          {...(source !== null ? { onGoToCode: handleGoToCode } : {})}
          onCopyText={handleCopyText}
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
        issues={diagram ? issues : []}
        source={combined}
        open={issuesOpen}
        onToggle={() => setIssuesOpen((v) => !v)}
        onSelect={handleIssueSelect}
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
          dirty={dirty}
          onSave={() => void handleCloseSave()}
          onDiscard={handleCloseDiscard}
          onCancel={handleCloseCancel}
        />
      )}
      {openPromptOpen && !closePromptOpen && (
        <CloseConfirmModal
          purpose="open"
          saving={openSaving}
          error={openError}
          dirty
          onSave={() => handleOpenChoice('save')}
          onDiscard={() => handleOpenChoice('discard')}
          onCancel={() => handleOpenChoice('cancel')}
        />
      )}
    </div>
  );
}
