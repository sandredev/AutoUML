// Panel del editor de código PlantUML (T7): CodeMirror 6 con resaltado propio, números de línea
// y los ParseIssue como diagnósticos. El texto vive en CodeMirror, no en el estado de React:
// cada tecla no re-renderiza la app (el host recibe el texto por onChange y lo procesa con debounce).
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching } from '@codemirror/language';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { Annotation, EditorState, StateEffect, StateField, type Text } from '@codemirror/state';
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { ParseIssue } from '../../domain/diagram/model';
import { useLocalization } from '../localization/LocalizationProvider';
import { keysOf } from '../../application/shortcuts';
import { withShortcut } from '../localization/translations';
import { issuesToDiagnostics } from './diagnostics';
import { EDITOR_DEFAULT_WIDTH, EDITOR_MAX_WIDTH, EDITOR_MIN_WIDTH } from './editorSize';
import { docText, eolOf } from './eol';
import { plantuml } from './pumlLanguage';
import { renameChanges } from './rename';
/** Lo que dura el resaltado de la declaración a la que se saltó. */
const FLASH_MS = 1600;

export interface CodeEditorHandle {
  getText(): string;
  /** Sustituye el documento (otro archivo o recarga desde disco). Vacía el historial de deshacer. */
  reset(text: string): void;
  /** Lleva el cursor a `line` y resalta [line, endLine] un momento, sin robar el foco. */
  revealLines(line: number, endLine?: number): void;
  /** Renombra un tipo y sus referencias en el texto como UN paso del historial (Ctrl+Z lo deshace entero). */
  renameType(oldId: string, newId: string): void;
  /** Sustituye el texto completo como UN paso del historial (Ctrl+Z lo deshace). Solo cambia lo que difiere. */
  applyText(next: string): void;
  focus(): void;
}

interface Props {
  /** Oculto sigue montado: conserva el texto, el cursor y el historial de deshacer (Ctrl+E alterna). */
  hidden?: boolean;
  /** Texto al montar; los cambios posteriores llegan por reset(). */
  initialText: string;
  /** Issues del último parseo (en líneas del archivo de entrada). */
  issues: readonly ParseIssue[];
  /** Archivo de entrada (para descartar los issues de los incluidos); null sin !include. */
  entryFile: string | null;
  fileName: string;
  width: number;
  onResize: (width: number) => void;
  dirty: boolean;
  /** El texto tiene errores graves y el diagrama muestra la última versión válida. */
  stale: boolean;
  /** El documento usa !include (lo incluido no se edita aquí). */
  hasIncludes: boolean;
  /** Cada cambio del usuario (no los de reset()). */
  onChange: (text: string) => void;
  /** El cursor pasó a otra línea (1-based) por acción del usuario. */
  onCursorLine: (line: number) => void;
  onSave: () => void;
  onClose: () => void;
}

/** Marca de las transacciones hechas por la app (reset, saltos): no son ediciones ni movimientos del usuario. */
const programmatic = Annotation.define<boolean>();

const setFlash = StateEffect.define<{ from: number; to: number } | null>();
const flashLine = Decoration.line({ class: 'cm-sync-flash' });

/** Colores del editor con las variables del tema de la app (claro, oscuro, alto contraste…). */
const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '12.5px', color: 'var(--fg)', backgroundColor: 'var(--bg-elev)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--fg)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--selected)',
  },
  '.cm-gutters': { backgroundColor: 'var(--bg-chrome)', color: 'var(--fg-muted)', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--fg)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)', outline: 'none' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-elev)', color: 'var(--fg)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)' },
  '.cm-diagnostic': { padding: '4px 8px', fontFamily: 'inherit', fontSize: '12px' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--cat-abstract)' },
});

/** Líneas resaltadas tras saltar a una declaración desde el diagrama. */
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setFlash)) continue;
      if (e.value === null) next = Decoration.none;
      else {
        const doc = tr.state.doc;
        const first = doc.lineAt(e.value.from).number;
        const last = doc.lineAt(e.value.to).number;
        const ranges = [];
        for (let n = first; n <= last; n++) ranges.push(flashLine.range(doc.line(n).from));
        next = Decoration.set(ranges);
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  { hidden = false, initialText, issues, entryFile, fileName, width, onResize, dirty, stale, hasIncludes, onChange, onCursorLine, onSave, onClose },
  ref,
) {
  const { t } = useLocalization();
  const hostRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  const dragging = useRef(false);

  // Callbacks siempre al día sin recrear la vista de CodeMirror.
  const handlers = useRef({ onChange, onCursorLine, onSave });
  handlers.current = { onChange, onCursorLine, onSave };
  const issuesRef = useRef({ issues, entryFile });
  issuesRef.current = { issues, entryFile };
  const ariaRef = useRef(t('editor.aria'));
  ariaRef.current = t('editor.aria');
  /** EOL del documento abierto: el texto que sale del editor (onChange, guardar) lo conserva. */
  const eolRef = useRef<string>('\n');
  const textOf = useCallback((doc: Text): string => docText(doc, eolRef.current), []);

  const stateFor = useCallback((text: string): EditorState => {
    let lastLine = -1;
    eolRef.current = eolOf(text);
    return EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        bracketMatching(),
        plantuml(),
        lintGutter(),
        flashField,
        editorTheme,
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              handlers.current.onSave();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          const external = update.transactions.some((tr) => tr.annotation(programmatic) === true);
          if (update.docChanged && !external) handlers.current.onChange(textOf(update.state.doc));
          if (!update.docChanged && !update.selectionSet) return;
          const line = update.state.doc.lineAt(update.state.selection.main.head).number;
          if (line === lastLine) return;
          lastLine = line;
          if (!external) handlers.current.onCursorLine(line);
        }),
        // Se lee al crear el estado: un cambio de idioma no recrea la vista (perdería lo escrito).
        EditorView.contentAttributes.of({ 'aria-label': ariaRef.current }),
      ],
    });
  }, [textOf]);

  const applyDiagnostics = useCallback((view: EditorView) => {
    const { issues: list, entryFile: file } = issuesRef.current;
    view.dispatch(setDiagnostics(view.state, issuesToDiagnostics(view.state.doc, list, file)));
  }, []);

  // La vista se crea una vez; el texto inicial solo cuenta al montar.
  const initialRef = useRef(initialText);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({ state: stateFor(initialRef.current), parent: host });
    viewRef.current = view;
    applyDiagnostics(view);
    return () => {
      if (flashTimer.current !== undefined) window.clearTimeout(flashTimer.current);
      view.destroy();
      viewRef.current = null;
    };
  }, [stateFor, applyDiagnostics]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) applyDiagnostics(view);
  }, [issues, entryFile, applyDiagnostics]);

  useImperativeHandle(
    ref,
    () => ({
      getText: () => (viewRef.current ? textOf(viewRef.current.state.doc) : ''),
      reset: (text) => {
        const view = viewRef.current;
        if (!view || (eolOf(text) === eolRef.current && textOf(view.state.doc) === text)) return;
        view.setState(stateFor(text));
        applyDiagnostics(view);
      },
      revealLines: (line, endLine = line) => {
        const view = viewRef.current;
        if (!view) return;
        const doc = view.state.doc;
        if (line < 1 || line > doc.lines) return;
        const from = doc.line(line).from;
        const to = doc.line(Math.min(Math.max(line, endLine), doc.lines)).from;
        view.dispatch({
          selection: { anchor: from },
          effects: [setFlash.of({ from, to }), EditorView.scrollIntoView(from, { y: 'center' })],
          annotations: programmatic.of(true),
        });
        if (flashTimer.current !== undefined) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => {
          flashTimer.current = undefined;
          viewRef.current?.dispatch({ effects: setFlash.of(null), annotations: programmatic.of(true) });
        }, FLASH_MS);
      },
      renameType: (oldId, newId) => {
        const view = viewRef.current;
        if (!view) return;
        const doc = view.state.doc;
        // Las ediciones van en línea/columna: valen igual con CRLF (en el editor un salto es 1 carácter).
        const edits = renameChanges(doc.toString(), oldId, newId);
        if (edits.length === 0) return;
        const changes = edits
          .filter((e) => e.line >= 1 && e.line <= doc.lines)
          .map((e) => {
            const base = doc.line(e.line).from;
            return { from: base + e.from, to: base + e.to, insert: e.insert };
          });
        // Una sola transacción del usuario: entra en el historial y Ctrl+Z la deshace de una vez.
        view.dispatch({ changes, userEvent: 'input.rename' });
      },
      applyText: (next) => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        if (current === next) return;
        // Recorta prefijo y sufijo comunes para que el historial guarde solo la diferencia.
        let from = 0;
        const max = Math.min(current.length, next.length);
        while (from < max && current[from] === next[from]) from++;
        let tailA = current.length;
        let tailB = next.length;
        while (tailA > from && tailB > from && current[tailA - 1] === next[tailB - 1]) {
          tailA--;
          tailB--;
        }
        view.dispatch({ changes: { from, to: tailA, insert: next.slice(from, tailB) }, userEvent: 'input.diagram' });
      },
      focus: () => viewRef.current?.focus(),
    }),
    [stateFor, applyDiagnostics, textOf],
  );

  // ---------- Ancho ajustable (como la sidebar) ----------
  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current || !panelRef.current) return;
      const left = panelRef.current.getBoundingClientRect().left;
      onResize(Math.min(EDITOR_MAX_WIDTH, Math.max(EDITOR_MIN_WIDTH, Math.round(e.clientX - left))));
    },
    [onResize],
  );
  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  return (
    <section className="code-editor" ref={panelRef} style={{ width }} hidden={hidden} aria-label={t('editor.title')}>
      <div className="code-editor-header">
        <span className="code-editor-title">{t('editor.title')}</span>
        <span className="code-editor-file" title={fileName}>
          {fileName}
        </span>
        {dirty ? (
          <span className="code-editor-dirty" title={t('editor.unsaved')}>
            ● {t('editor.unsaved')}
          </span>
        ) : null}
        <button
          type="button"
          className="code-editor-btn"
          disabled={!dirty}
          title={withShortcut(t('editor.save'), keysOf('save'))}
          onClick={() => handlers.current.onSave()}
        >
          {t('editor.save')}
        </button>
        <button
          type="button"
          className="code-editor-btn code-editor-close"
          title={withShortcut(t('editor.close'), keysOf('toggleEditor'))}
          aria-label={withShortcut(t('editor.close'), keysOf('toggleEditor'))}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {stale || hasIncludes ? (
        <div className="code-editor-notes">
          {stale ? (
            <p className="code-editor-stale" role="status">
              {t('editor.stale')}
            </p>
          ) : null}
          {hasIncludes ? <p className="code-editor-hint">{t('editor.includes')}</p> : null}
        </div>
      ) : null}
      <div className="code-editor-host" ref={hostRef} />
      <div
        className="resizer"
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={EDITOR_MIN_WIDTH}
        aria-valuemax={EDITOR_MAX_WIDTH}
        title={t('editor.resizeHint')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => onResize(EDITOR_DEFAULT_WIDTH)}
      />
    </section>
  );
});
