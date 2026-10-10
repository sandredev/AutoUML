// Carga un .puml con sus !include ya resueltos. Testeable con tmp real.
// Módulo de main sin Electron: solo fs/path más el core puro.
import fs from 'node:fs';
import path from 'node:path';
import { combineSources, type CombinedSource } from '../core/include';
import { PUML_EXTENSIONS } from '../shared/validation';

const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_INCLUDE_BYTES = 5 * 1024 * 1024;

/** Extensiones legibles como incluido (base del repo más .iuml). */
const READABLE_EXTS = new Set<string>([...PUML_EXTENSIONS, '.iuml', '.plantuml'].map((e) => e.toLowerCase()));

export interface LoadedSource extends CombinedSource {
  /** Ruta absoluta normalizada del archivo de entrada. */
  entryPath: string;
  /** Texto tal cual de la entrada (para guardar). */
  entryText: string;
}

/** En win32 el fs no distingue mayúsculas: se normaliza a minúsculas. */
function norm(p: string): string {
  const n = path.normalize(p);
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

/** Lee un incluido si tiene extensión permitida, es archivo y no supera 5 MB. */
function readIncluded(absPath: string): string | undefined {
  if (!READABLE_EXTS.has(path.extname(absPath).toLowerCase())) return undefined;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return undefined;
  }
  if (!stat.isFile() || stat.size > MAX_INCLUDE_BYTES) return undefined;
  try {
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    return undefined;
  }
}

/** Lee la entrada (límite 50 MB) y la combina con sus incluidos. */
export function loadSourceWithIncludes(absEntry: string): LoadedSource {
  const entryPath = norm(absEntry);
  const entryText = fs.readFileSync(entryPath, 'utf8');
  if (Buffer.byteLength(entryText, 'utf8') > MAX_ENTRY_BYTES) {
    throw new Error('El archivo supera el límite de 50 MB.');
  }
  const combined = combineSources(
    entryPath,
    (from, raw) => norm(path.resolve(path.dirname(from), raw)),
    (abs) => (norm(abs) === entryPath ? entryText : readIncluded(abs)),
  );
  return { ...combined, entryPath, entryText };
}
