// Resolución !include pura (sin E/S): el llamador inyecta resolve + readFile.
// Módulo puro: sin Electron, sin React, sin acceso al disco.
export type IncludeMode = 'include' | 'once' | 'many';

export interface IncludeDirective {
  /** Ruta tal cual aparece en la directiva (sin comillas envolventes). */
  raw: string;
  mode: IncludeMode;
  /** 1-based, dentro de su archivo. */
  line: number;
}

const RE_INCLUDE_LINE = /^!include(_once|once|_many)?\s+(.+?)\s*$/iu;
const RE_START = /^@startuml\b/iu;
const RE_END = /^@enduml\b/iu;

/** Quita las comillas envolventes ("..." o '...') si las hay. */
function unquote(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2) {
    const first = t.charAt(0);
    const last = t.charAt(t.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return t.slice(1, -1).trim();
  }
  return t;
}

/** Examina el texto y devuelve las directivas include de PlantUML. */
export function scanIncludes(text: string): IncludeDirective[] {
  const out: IncludeDirective[] = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  lines.forEach((line, idx) => {
    const t = line.trim();
    const m = RE_INCLUDE_LINE.exec(t);
    if (!m) return;
    // RE_INCLUDE_LINE también casa "!includesub..." por el prefijo; se excluye.
    if (/^!includesub\b/iu.test(t)) return;
    const suffix = (m[1] ?? '').toLowerCase();
    const mode: IncludeMode = suffix === '_many' ? 'many' : suffix === 'once' || suffix === '_once' ? 'once' : 'include';
    // "!include" sin sufijo pero con subcomando pegado (p. ej. "!includeurl") no vale.
    if (suffix === '' && /^!include[^ \t"']+/iu.test(t) && !/^!include[ \t]/iu.test(t)) return;
    const raw = unquote(m[2] ?? '');
    if (raw === '') return;
    out.push({ raw, mode, line: idx + 1 });
  });
  return out;
}

export interface CombinedLineRef {
  /** Archivo absoluto de origen. */
  file: string;
  /** 1-based en su archivo. */
  line: number;
}

export interface CombineIssue {
  file: string;
  line: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface CombinedSource {
  /** Directivas consumidas y contenido expandido. */
  text: string;
  /** Origen de cada línea de `text` (índice = nº de línea − 1). */
  lineMap: CombinedLineRef[];
  /** Entrada + incluidos leídos (abs, sin duplicados, en orden). */
  files: string[];
  /** Avisos de la resolución (faltantes, ciclos, profundidad). */
  issues: CombineIssue[];
}

/**
 * Expande los !include de forma recursiva.
 * - `!include` e `!includeonce`/`!include_once`: un archivo se expande UNA vez
 *   global; las siguientes referencias son no-op silencioso.
 * - `!include_many`: se expande cada vez (con guarda de ciclo).
 * - Ciclo → error con la cadena `a → b → a`; se corta esa rama.
 * - Profundidad > max → error y se corta esa rama.
 * - Ilegible → warning y se sigue sin esa rama.
 * - Las directivas se consumen (el parser no las ve) y las líneas
 *   `@startuml`/`@enduml` de los incluidos se omiten.
 */
export function combineSources(
  entryPath: string,
  resolve: (fromFile: string, raw: string) => string,
  readFile: (absPath: string) => string | undefined,
  opts?: { maxDepth?: number },
): CombinedSource {
  const maxDepth = opts?.maxDepth ?? 20;
  const files: string[] = [];
  const knownFiles = new Set<string>();
  const expandedOnce = new Set<string>();
  const issues: CombineIssue[] = [];
  const outLines: string[] = [];
  const lineMap: CombinedLineRef[] = [];

  function noteFile(abs: string): void {
    if (!knownFiles.has(abs)) {
      knownFiles.add(abs);
      files.push(abs);
    }
  }

  function expand(abs: string, ancestors: readonly string[]): void {
    const content = readFile(abs);
    if (content === undefined) {
      return;
    }
    noteFile(abs);
    const depth = ancestors.length;
    const lines = content.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    const isEntry = depth === 0;
    lines.forEach((line, idx) => {
      const lineNo = idx + 1;
      const t = line.trim();
      const m = RE_INCLUDE_LINE.exec(t);
      const isSub = /^!includesub\b/iu.test(t);
      if (m && !isSub) {
        const suffix = (m[1] ?? '').toLowerCase();
        if (!(suffix === '' && /^!include[^ \t"']+/iu.test(t) && !/^!include[ \t]/iu.test(t))) {
          const mode: IncludeMode = suffix === '_many' ? 'many' : suffix === 'once' || suffix === '_once' ? 'once' : 'include';
          const raw = unquote(m[2] ?? '');
          if (raw !== '') {
            const target = resolve(abs, raw);
            if (mode !== 'many' && expandedOnce.has(target)) return;
            // Ciclo: el objetivo ya está en la pila de ancestros (o es el propio archivo).
            const chain = [...ancestors, abs];
            if (chain.includes(target) || target === abs) {
              const fromIdx = chain.indexOf(target);
              const cycle = (fromIdx >= 0 ? chain.slice(fromIdx) : chain).concat(target).join(' → ');
              issues.push({ file: abs, line: lineNo, severity: 'error', message: `Ciclo en !include: ${cycle}` });
              return;
            }
            if (depth + 1 > maxDepth) {
              issues.push({ file: abs, line: lineNo, severity: 'error', message: `Se superó la profundidad máxima de !include (${maxDepth})` });
              return;
            }
            const child = readFile(target);
            if (child === undefined) {
              issues.push({ file: abs, line: lineNo, severity: 'warning', message: `No se pudo incluir "${raw}": no existe o no se puede leer` });
              return;
            }
            if (mode !== 'many') expandedOnce.add(target);
            expand(target, [...ancestors, abs]);
            return;
          }
        }
      }
      // Omite los marcadores de los incluidos; la entrada los conserva.
      if (!isEntry && (RE_START.test(t) || RE_END.test(t))) return;
      outLines.push(line);
      lineMap.push({ file: abs, line: lineNo });
    });
  }

  const entryText = readFile(entryPath);
  if (entryText === undefined) {
    return {
      text: '',
      lineMap: [],
      files: [entryPath],
      issues: [{ file: entryPath, line: 1, severity: 'warning', message: 'No se pudo leer el archivo de entrada.' }],
    };
  }
  expand(entryPath, []);
  return { text: outLines.join('\n'), lineMap, files, issues };
}
