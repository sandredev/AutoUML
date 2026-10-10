// src/domain/diagram/skinparam.ts — lectura de skinparam (pura). Lo que no se soporta se ignora sin error.
export type Skinparams = Record<string, string>;

const SUPPORTED = new Set([
  'classbackgroundcolor',
  'classbordercolor',
  'arrowcolor',
  'packagebackgroundcolor',
  'backgroundcolor',
  'linetype',
  'classattributeiconsize',
]);

const RE_ONE = /^skinparam\s+([A-Za-z]+)\s+(.+?)\s*$/iu;
const RE_BLOCK_OPEN = /^skinparam\s+([A-Za-z]+)?\s*\{\s*$/iu;
const RE_BLOCK_ITEM = /^([A-Za-z]+)(?:<<[^>]*>>)?\s+(.+?)\s*$/u;
/**
 * Líneas que no pueden ser un "Clave valor" de un bloque skinparam: si aparecen dentro del bloque
 * es que falta su "}". Se cierra el bloque (con aviso) y la línea la procesa el parser.
 */
const RE_NOT_ITEM =
  /^(?:@enduml\b|skinparam\b|(?:abstract\s+class|abstract|class|interface|enum|record|annotation|struct|entity|exception|protocol|object|package|namespace|note|together|hide|show|remove)\b|\S+\s+\S*(?:--|\.\.)\S*\s+\S+)/iu;

export interface SkinparamWarning {
  line: number;
  message: string;
}

/**
 * Lector con estado para usar dentro del bucle del parser: `if (skin.feed(line, lineNo)) continue;`.
 * Admite `skinparam X valor` y bloques `skinparam class { BackgroundColor x }`.
 * Un bloque sin cerrar NO se traga el resto del archivo: se cierra al llegar a una línea que no es
 * un "Clave valor" (o al final, con finish()) y queda un aviso.
 */
export class SkinparamReader {
  readonly values: Skinparams = {};
  readonly warnings: SkinparamWarning[] = [];
  private block: { prefix: string; line: number } | null = null;

  feed(line: string, lineNo = 0): boolean {
    if (this.block !== null) {
      if (line === '}') {
        this.block = null;
        return true;
      }
      if (RE_NOT_ITEM.test(line)) {
        this.unclosed();
        return this.feed(line, lineNo);
      }
      const m = RE_BLOCK_ITEM.exec(line);
      if (m?.[1] && m[2]) this.set(this.block.prefix + m[1], m[2]);
      return true;
    }
    const open = RE_BLOCK_OPEN.exec(line);
    if (open) {
      this.block = { prefix: open[1] ?? '', line: lineNo };
      return true;
    }
    const one = RE_ONE.exec(line);
    if (one?.[1] && one[2]) {
      this.set(one[1], one[2]);
      return true;
    }
    return false;
  }

  /** Llamar al terminar el archivo: avisa si quedó un bloque abierto. */
  finish(): void {
    if (this.block !== null) this.unclosed();
  }

  private unclosed(): void {
    if (!this.block) return;
    this.warnings.push({ line: this.block.line, message: 'Bloque skinparam sin cerrar (falta "}")' });
    this.block = null;
  }

  private set(rawKey: string, rawValue: string): void {
    const key = rawKey.toLowerCase();
    if (!SUPPORTED.has(key)) return;
    this.values[key] = rawValue.replace(/^"(.*)"$/u, '$1').trim();
  }
}

/** Un color PlantUML ("#hex", nombre CSS o "#Nombre") a color CSS. undefined si no se reconoce. */
export function plantColor(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(s)) return s;
  if (/^#?[a-z]+$/iu.test(s)) return s.replace(/^#/u, '');
  return undefined;
}
