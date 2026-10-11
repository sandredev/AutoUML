// tests/presentation/app/themeContrast.test.ts — contraste AA (4.5:1) de los pares de color que usan el menú
// contextual y el panel de filtros (T8) en los 6 temas. Lee los tokens reales de theme.css.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_IDS } from '../../../src/domain/rules/themes';

const css = readFileSync(resolve(__dirname, '../../../src/presentation/app/theme.css'), 'utf8');

/** Tokens `--x: #hex` del bloque `:root[data-theme="<id>"] { … }`. */
function themeTokens(id: string): Map<string, string> {
  const block = new RegExp(`:root\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`).exec(css);
  if (!block) throw new Error(`tema sin bloque: ${id}`);
  const tokens = new Map<string, string>();
  for (const m of block[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) tokens.set(m[1], m[2]);
  return tokens;
}

/** Luminancia relativa WCAG 2.x de un #rrggbb. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const styles = readFileSync(resolve(__dirname, '../../../src/presentation/app/styles.css'), 'utf8');

/** Token `--x` de la propiedad `prop: var(--x)` en la regla `selector { … }` de styles.css. */
function ruleToken(selector: string, prop: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(styles);
  if (!rule) throw new Error(`regla no encontrada: ${selector}`);
  const decl = new RegExp(`(?:^|[;\\s])${prop}:\\s*var\\(--([\\w-]+)`).exec(rule[1]);
  if (!decl) throw new Error(`${selector} sin ${prop}: var(--…)`);
  return decl[1];
}

// [texto, fondo, dónde]. Los del elemento activo y los enlaces se leen de las reglas reales.
const PAIRS: Array<[string, string, string]> = [
  ['fg', 'bg-elev', 'menú y panel: texto normal'],
  [ruleToken('.context-menu-item:focus', 'color'), ruleToken('.context-menu-item:focus', 'background'), 'menú: elemento activo'],
  [ruleToken('.filters-panel-link', 'color'), 'bg-elev', 'panel: enlaces'],
  ['fg-muted', 'bg-elev', 'menú: deshabilitado; panel: pistas'],
];

describe('contraste del menú contextual y del panel de filtros', () => {
  it.each(THEME_IDS.flatMap((id) => PAIRS.map(([fg, bg, where]) => [id, fg, bg, where] as const)))(
    '%s: --%s sobre --%s ≥ 4.5 (%s)',
    (id, fg, bg) => {
      const t = themeTokens(id);
      const a = t.get(fg);
      const b = t.get(bg);
      expect(a, `--${fg}`).toBeDefined();
      expect(b, `--${bg}`).toBeDefined();
      expect(contrast(a as string, b as string)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
