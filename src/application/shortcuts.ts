// src/application/shortcuts.ts — mapa único de atajos con Ctrl/Cmd (#39). Menú nativo, menú del renderer,
// cabecera y despacho global leen de aquí: lo anunciado es lo que se despacha, sin duplicados.
import type { MenuAction, MenuState } from './ports/ipc';

export interface ShortcutDef {
  /** Texto anunciado (title, menú del renderer): 'Ctrl+Shift+O'. */
  keys: string;
  /** 'global': lo despacha el renderer en window; 'viewer': lo atiende el visor (no entra en el despacho global). */
  scope: 'global' | 'viewer';
  /** Acción de menú que ejecuta (null: no es acción de menú, la atiende App). */
  action: MenuAction | null;
}

export const SHORTCUTS = {
  newProject: { keys: 'Ctrl+N', scope: 'global', action: 'new-project' },
  openProject: { keys: 'Ctrl+Shift+O', scope: 'global', action: 'open-project' },
  loadPuml: { keys: 'Ctrl+O', scope: 'global', action: 'load-puml' },
  reload: { keys: 'Ctrl+R', scope: 'global', action: 'reload-puml' },
  save: { keys: 'Ctrl+S', scope: 'global', action: 'save' },
  exportSvg: { keys: 'Ctrl+Shift+E', scope: 'global', action: 'export-svg' },
  exportPdf: { keys: 'Ctrl+Shift+P', scope: 'global', action: 'export-pdf' },
  copyPng: { keys: 'Ctrl+Shift+C', scope: 'global', action: 'copy-png' },
  zoomIn: { keys: 'Ctrl+=', scope: 'global', action: 'zoom-in' },
  zoomOut: { keys: 'Ctrl+-', scope: 'global', action: 'zoom-out' },
  fit: { keys: 'Ctrl+0', scope: 'global', action: 'fit' },
  toggleSidebar: { keys: 'Ctrl+B', scope: 'global', action: 'toggle-sidebar' },
  toggleEditor: { keys: 'Ctrl+E', scope: 'global', action: 'toggle-editor' },
  settings: { keys: 'Ctrl+,', scope: 'global', action: 'settings-more' },
  relayout: { keys: 'Ctrl+Shift+L', scope: 'global', action: null },
  // Pantalla completa del área de render (botón del header). Ctrl+0 es encuadrar, no esto.
  fullscreen: { keys: 'F11', scope: 'global', action: null },
  palette: { keys: 'Ctrl+K', scope: 'viewer', action: null },
} as const satisfies Record<string, ShortcutDef>;

export type ShortcutId = keyof typeof SHORTCUTS;

export const keysOf = (id: ShortcutId): string => SHORTCUTS[id].keys;

/** Acelerador de Electron ('Ctrl' → 'CmdOrCtrl'). */
export const acceleratorOf = (id: ShortcutId): string => SHORTCUTS[id].keys.replace(/^Ctrl/, 'CmdOrCtrl');

export const actionOfShortcut = (id: ShortcutId): MenuAction | null => SHORTCUTS[id].action;

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

// '+' (Ctrl+Mayús+= en teclado US, o la tecla + del ES) cuenta como '=': ambos acercan.
const ALIAS: Readonly<Record<string, string>> = { '+': '=' };

const GLOBAL = (Object.entries(SHORTCUTS) as [ShortcutId, ShortcutDef][])
  .filter(([, s]) => s.scope === 'global')
  .map(([id, s]) => {
    const parts = s.keys.split('+');
    // 'Ctrl+,' acaba en una coma: split('+') sigue siendo correcto; '+' solo aparece como separador.
    return { id, key: parts[parts.length - 1].toLowerCase(), shift: parts.includes('Shift'), ctrl: parts[0] === 'Ctrl' };
  });

/** Atajo global de una pulsación (con Ctrl/Cmd salvo las teclas de función, sin Alt) o null. */
export function matchShortcut(e: KeyLike): ShortcutId | null {
  if (e.altKey) return null;
  const withCtrl = e.ctrlKey || e.metaKey;
  const raw = e.key.toLowerCase();
  const key = ALIAS[raw] ?? raw;
  // Las que llevan Mayús en el mapa la exigen; las demás toleran Mayús solo para el alias '+' (Ctrl+Mayús+=).
  const hit = GLOBAL.find((s) => s.ctrl === withCtrl && s.key === key && (s.shift ? e.shiftKey : !e.shiftKey || raw === '+'));
  return hit?.id ?? null;
}

/** ¿Está habilitada la opción de menú del atajo? Mismo criterio que `enabled` en el menú. */
export function isShortcutEnabled(id: ShortcutId, s: MenuState): boolean {
  switch (id) {
    case 'loadPuml':
      return s.projectOpen;
    case 'save':
      return s.hasPuml && s.dirty;
    case 'toggleSidebar':
      return s.projectOpen || s.hasPuml;
    case 'reload':
    case 'exportSvg':
    case 'exportPdf':
    case 'copyPng':
    case 'zoomIn':
    case 'zoomOut':
    case 'fit':
    case 'toggleEditor':
    case 'relayout':
    case 'fullscreen':
      return s.hasPuml;
    default:
      return true;
  }
}
