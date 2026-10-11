// src/presentation/diagram/contextMenu.ts — qué ofrece el menú contextual del lienzo según dónde se abra (puro, T8).
import type { RelType } from '../../domain/diagram/model';
import { fill, type ViewerLabels } from './labels';

/** Sobre qué se abrió el menú (ya resuelto a nombres, línea y tipo). */
export type MenuSubject =
  | { kind: 'node'; id: string; name: string; packageName: string }
  | { kind: 'package'; id: string; name: string }
  | { kind: 'edge'; name: string; relType: RelType; line: number | null }
  | { kind: 'background' };

export type MenuAction =
  | 'focus' | 'route-from' | 'copy-name' | 'go-to-code' | 'hide-node' | 'collapse-package' | 'expand-package'
  | 'hide-rel-type' | 'fit' | 'clear-route' | 'exit-focus' | 'clear-filters';

export interface MenuEntry {
  action: MenuAction;
  label: string;
  disabled?: boolean;
  shortcut?: string;
}

export interface MenuContext {
  /** Hay editor de código al que saltar (T7). */
  canGoToCode: boolean;
  hasRoute: boolean;
  inFocus: boolean;
  hasFilters: boolean;
}

const DEFAULT_PACKAGE = '(default package)';

export function contextMenuEntries(subject: MenuSubject, ctx: MenuContext, labels: ViewerLabels): MenuEntry[] {
  switch (subject.kind) {
    case 'node': {
      const pkg = subject.packageName && subject.packageName !== DEFAULT_PACKAGE ? subject.packageName : null;
      return [
        { action: 'focus', label: labels.menuFocus, shortcut: 'F' },
        { action: 'route-from', label: labels.menuRouteFrom },
        { action: 'copy-name', label: labels.menuCopyName },
        { action: 'go-to-code', label: labels.menuGoToCode, disabled: !ctx.canGoToCode },
        { action: 'hide-node', label: labels.menuHideClass },
        {
          action: 'collapse-package',
          label: pkg ? fill(labels.menuCollapsePackage, { name: pkg }) : fill(labels.menuCollapsePackage, { name: labels.noPackage }),
          disabled: pkg === null,
        },
      ];
    }
    case 'package':
      return [
        { action: 'focus', label: labels.menuFocus, shortcut: 'F' },
        { action: 'route-from', label: labels.menuRouteFrom },
        { action: 'copy-name', label: labels.menuCopyName },
        { action: 'expand-package', label: labels.menuExpandPackage },
        { action: 'hide-node', label: labels.menuHidePackage },
      ];
    case 'edge':
      return [
        // Una arista agregada de paquetes plegados no tiene una línea concreta.
        { action: 'go-to-code', label: labels.menuGoToCode, disabled: !ctx.canGoToCode || subject.line === null },
        { action: 'copy-name', label: labels.menuCopyName },
        { action: 'hide-rel-type', label: fill(labels.menuHideRelType, { type: labels.relTypes[subject.relType] }) },
      ];
    case 'background': {
      const out: MenuEntry[] = [{ action: 'fit', label: labels.menuFit }];
      if (ctx.hasRoute) out.push({ action: 'clear-route', label: labels.menuClearRoute, shortcut: 'Esc' });
      if (ctx.inFocus) out.push({ action: 'exit-focus', label: labels.menuExitFocus, shortcut: 'Esc' });
      if (ctx.hasFilters) out.push({ action: 'clear-filters', label: labels.menuClearFilters });
      return out;
    }
  }
}
