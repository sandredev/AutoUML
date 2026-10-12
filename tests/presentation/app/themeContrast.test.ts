// tests/presentation/app/themeContrast.test.ts — contraste AA (4.5:1) de los pares de color que usan el menú
// contextual y el panel de filtros (T8) en los 6 temas. Lee los tokens reales de theme.css.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_IDS } from '../../../src/domain/rules/themes';

const css = readFileSync(resolve(__dirname, '../../../src/presentation/app/theme.css'), 'utf8');

/**
 * Tokens `--x: #hex` que aplican al tema `<id>`: se funden, en orden, todos los bloques cuyo selector nombra
 * `[data-theme="<id>"]` (el del tema y los grupos semánticos claros/oscuros).
 */
function themeTokens(id: string): Map<string, string> {
  const tokens = new Map<string, string>();
  let found = false;
  for (const block of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!block[1].includes(`[data-theme="${id}"]`)) continue;
    found = true;
    for (const m of block[2].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) tokens.set(m[1], m[2]);
  }
  if (!found) throw new Error(`tema sin bloque: ${id}`);
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

// Capa de análisis (T9): las marcas de aristas son líneas (no texto): ≥ 3:1 sobre el lienzo (--bg-elev).
// En el mapa de calor el texto de la tarjeta se elige negro o blanco (el de más contraste): ≥ 4.5:1.
describe('contraste de la capa de análisis (T9)', () => {
  const best = (bg: string): number => Math.max(contrast(bg, '#000000'), contrast(bg, '#ffffff'));

  it.each(THEME_IDS.flatMap((id) => (['mark-cycle', 'mark-violation'] as const).map((k) => [id, k] as const)))(
    '%s: --%s sobre --bg-elev ≥ 3',
    (id, k) => {
      const t = themeTokens(id);
      expect(contrast(t.get(k) as string, t.get('bg-elev') as string)).toBeGreaterThanOrEqual(3);
    },
  );

  it.each([...THEME_IDS])('%s: 5 pasos de calor, texto legible en cada uno', (id) => {
    const t = themeTokens(id);
    for (let i = 1; i <= 5; i++) {
      const c = t.get(`heat-${i}`);
      expect(c, `--heat-${i}`).toBeDefined();
      expect(best(c as string)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([...THEME_IDS])('%s: la rampa es secuencial (contraste con el lienzo creciente)', (id) => {
    const t = themeTokens(id);
    const bg = t.get('bg-elev') as string;
    const steps = [1, 2, 3, 4, 5].map((i) => contrast(t.get(`heat-${i}`) as string, bg));
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1] as number);
  });
});

// Rediseño (T11): paneles, lienzo, selección y diagrama. Texto ≥ 4.5:1; bordes de controles, líneas del
// diagrama, iconos de estado y foco ≥ 3:1.
describe('contraste de la paleta del rediseño (T11)', () => {
  const TEXT: Array<[string, string]> = [
    ['fg', 'bg-chrome'], ['fg-muted', 'bg-chrome'], ['fg', 'canvas'], ['fg-muted', 'canvas'],
    ['fg-muted', 'bg-elev'], ['fg', 'selected'], ['fg-muted', 'selected'], ['accent', 'bg-chrome'],
    ['fg-muted', 'bg-sunken'], ['uml-card-fg', 'uml-card'], ['uml-pkg-fg', 'canvas'],
    ['cat-class', 'uml-card'], ['cat-abstract', 'uml-card'], ['cat-interface', 'uml-card'], ['cat-enum', 'uml-card'],
    ['cat-class', 'bg-chrome'], ['cat-abstract', 'bg-chrome'], ['cat-interface', 'bg-chrome'], ['cat-enum', 'bg-chrome'],
  ];
  const LINES: Array<[string, string]> = [
    ['border-strong', 'bg-chrome'], ['border-strong', 'canvas'], ['uml-pkg', 'canvas'], ['uml-card-border', 'canvas'],
    ['uml-card-border', 'uml-card'], ['uml-edge', 'canvas'], ['warn', 'bg-chrome'], ['danger', 'bg-chrome'],
    ['focus-ring', 'bg-chrome'], ['focus-ring', 'canvas'], ['accent', 'canvas'],
  ];
  it.each(THEME_IDS.flatMap((id) => TEXT.map(([fg, bg]) => [id, fg, bg] as const)))('%s: texto --%s sobre --%s ≥ 4.5', (id, fg, bg) => {
    const t = themeTokens(id);
    expect(contrast(t.get(fg) as string, t.get(bg) as string)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(THEME_IDS.flatMap((id) => LINES.map(([fg, bg]) => [id, fg, bg] as const)))('%s: línea --%s sobre --%s ≥ 3', (id, fg, bg) => {
    const t = themeTokens(id);
    expect(contrast(t.get(fg) as string, t.get(bg) as string)).toBeGreaterThanOrEqual(3);
  });
  it('el ámbar de los avisos no es el color de las abstractas', () => {
    for (const id of THEME_IDS) {
      const t = themeTokens(id);
      expect(t.get('cat-abstract')).not.toBe(t.get('warn'));
    }
  });
});

// El glifo de categoría (lista, inspector y lienzo) es la letra sobre un tinte del 16 % de su propio color: la
// letra (12 px, negrita) tiene que dar 4.5:1 sobre ese tinte en los paneles, la tarjeta y la fila seleccionada.
describe('glifos de categoría sobre su tinte (T11)', () => {
  const mix = (c: string, b: string, a: number): string =>
    '#' + [1, 3, 5].map((i) => Math.round(parseInt(c.slice(i, i + 2), 16) * a + parseInt(b.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('');
  const CATS = ['sealed', 'abstract', 'interface', 'enum', 'record', 'annotation', 'class', 'external', 'undeclared'];
  it.each(THEME_IDS.flatMap((id) => CATS.flatMap((c) => ['bg-chrome', 'uml-card', 'selected'].map((bg) => [id, c, bg] as const))))(
    '%s: --cat-%s sobre su tinte en --%s ≥ 4.5',
    (id, c, bg) => {
      const t = themeTokens(id);
      const fg = t.get(`cat-${c}`) as string;
      const under = id === 'contrast' ? (t.get(bg) as string) : mix(fg, t.get(bg) as string, 0.16);
      expect(contrast(fg, under)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
