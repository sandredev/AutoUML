// Acciones de la paleta de comandos (T10.2): exportar, plegar/desplegar todo, filtros, tema y las del menú
// contextual aplicadas a la clase enfocada. Puro: quien lo usa inyecta los efectos en `host`.
import { contextMenuEntries, type MenuAction, type MenuContext, type MenuSubject } from '../contextMenu';
import { fill, type ViewerLabels } from '../labels';

/** Acciones de la barra de menú que la paleta delega en la app. */
export type AppAction = 'export' | 'export-svg' | 'export-pdf' | 'copy-png';

export interface PaletteAction {
  id: string;
  /** Texto buscable y resaltable (compatible con `fuzzySearch`). */
  label: string;
  /** Texto secundario (la clase sobre la que actúa una acción contextual). */
  detail?: string;
  enabled: boolean;
  run(): void;
}

export interface PaletteActionLabels {
  exportPng: string;
  exportSvg: string;
  exportPdf: string;
  copyPng: string;
  collapseAll: string;
  expandAll: string;
  clearFilters: string;
  /** "Tema: {name}" */
  theme: string;
}

export interface PaletteActionsInput {
  labels: PaletteActionLabels;
  /** Textos del menú contextual (se reutilizan tal cual). */
  viewerLabels: ViewerLabels;
  themes: readonly { mode: string; name: string }[];
  hasDocument: boolean;
  packageCount: number;
  collapsedCount: number;
  hasFilters: boolean;
  /** Clase enfocada/seleccionada: sobre ella actúan las acciones contextuales. */
  focused: Extract<MenuSubject, { kind: 'node' }> | null;
  menuContext: MenuContext;
  host: {
    app(action: AppAction): void;
    context(action: MenuAction, subject: MenuSubject): void;
    collapseAll(): void;
    expandAll(): void;
    clearFilters(): void;
    theme(mode: string): void;
  };
}

export function buildPaletteActions(input: PaletteActionsInput): PaletteAction[] {
  const { labels, host, hasDocument } = input;
  const app = (id: AppAction, label: string): PaletteAction => ({
    id: `app:${id}`,
    label,
    enabled: hasDocument,
    run: () => host.app(id),
  });
  const out: PaletteAction[] = [
    app('export', labels.exportPng),
    app('export-svg', labels.exportSvg),
    app('export-pdf', labels.exportPdf),
    app('copy-png', labels.copyPng),
    {
      id: 'view:collapse-all',
      label: labels.collapseAll,
      enabled: input.packageCount > input.collapsedCount,
      run: host.collapseAll,
    },
    { id: 'view:expand-all', label: labels.expandAll, enabled: input.collapsedCount > 0, run: host.expandAll },
    { id: 'filters:clear', label: labels.clearFilters, enabled: input.hasFilters, run: host.clearFilters },
    ...input.themes.map((t): PaletteAction => ({
      id: `theme:${t.mode}`,
      label: fill(labels.theme, { name: t.name }),
      enabled: true,
      run: () => host.theme(t.mode),
    })),
  ];

  const subject = input.focused;
  if (subject) {
    for (const entry of contextMenuEntries(subject, input.menuContext, input.viewerLabels)) {
      out.push({
        id: `ctx:${entry.action}`,
        label: entry.label,
        detail: subject.name,
        enabled: entry.disabled !== true,
        run: () => host.context(entry.action, subject),
      });
    }
  }
  return out;
}
