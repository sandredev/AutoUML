// Acceso a disco para los proyectos. Toda la E/S vive en el proceso main.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { PumlInfo, ProjectInfo, ProjectMeta, ProjectSummary, StorageInfo } from '../shared/ipc';
import { validateProjectName } from '../shared/validation';

const PROJECT_FILE = 'project.json';
export const PUML_FILE = 'diagram.puml';

let storage: StorageInfo | null = null;
let currentProject: string | null = null;

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Comprueba la escritura real creando y borrando un archivo de prueba. */
function isWritable(dir: string): boolean {
  try {
    ensureDir(dir);
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** Carpeta del ejecutable: portable de Windows, AppImage o binario normal. */
function executableDir(): string {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.env.APPIMAGE) return path.dirname(process.env.APPIMAGE);
  return path.dirname(app.getPath('exe'));
}

export function initStorage(): StorageInfo {
  const userDataRoot = path.join(app.getPath('userData'), 'projects');
  if (!app.isPackaged) {
    ensureDir(userDataRoot);
    storage = { root: userDataRoot, mode: 'dev', warning: null };
    return storage;
  }
  const preferred = path.join(executableDir(), 'projects');
  if (isWritable(preferred)) {
    storage = { root: preferred, mode: 'exe', warning: null };
  } else {
    ensureDir(userDataRoot);
    storage = {
      root: userDataRoot,
      mode: 'fallback',
      warning: `No hay permiso de escritura en "${preferred}". Los proyectos se guardarán en "${userDataRoot}".`
    };
  }
  return storage;
}

export function getStorage(): StorageInfo {
  return storage ?? initStorage();
}

function atomicWrite(file: string, data: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

function readMeta(dir: string): ProjectMeta | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, PROJECT_FILE), 'utf8')) as Partial<ProjectMeta>;
    if (typeof raw.name !== 'string' || typeof raw.createdAt !== 'string') return null;
    const pumlFile = raw.pumlFile === PUML_FILE ? PUML_FILE : null;
    return {
      name: raw.name,
      createdAt: raw.createdAt,
      pumlFile,
      originalFileName: typeof raw.originalFileName === 'string' ? raw.originalFileName : null,
      pumlLoadedAt: typeof raw.pumlLoadedAt === 'string' ? raw.pumlLoadedAt : null
    };
  } catch {
    return null;
  }
}

function writeMeta(dir: string, meta: ProjectMeta): void {
  atomicWrite(path.join(dir, PROJECT_FILE), JSON.stringify(meta, null, 2));
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  const parts = text.split(/\r\n|\r|\n/);
  return parts[parts.length - 1] === '' ? parts.length - 1 : parts.length;
}

function readPumlInfo(dir: string, meta: ProjectMeta): PumlInfo | null {
  if (!meta.pumlFile) return null;
  try {
    const buf = fs.readFileSync(path.join(dir, meta.pumlFile));
    return {
      fileName: meta.pumlFile,
      originalFileName: meta.originalFileName ?? meta.pumlFile,
      lines: countLines(buf.toString('utf8')),
      sizeBytes: buf.length,
      loadedAt: meta.pumlLoadedAt
    };
  } catch {
    return null;
  }
}

function assertValidName(name: string): string {
  const trimmed = name.trim();
  const error = validateProjectName(trimmed);
  if (error) throw new Error(error);
  return trimmed;
}

/** Busca una carpeta existente con el mismo nombre sin distinguir mayúsculas (Windows). */
function findExisting(name: string): string | null {
  const lower = name.toLowerCase();
  const entries = fs.readdirSync(getStorage().root, { withFileTypes: true });
  const hit = entries.find((e) => e.isDirectory() && e.name.toLowerCase() === lower);
  return hit ? hit.name : null;
}

export function listProjects(): ProjectSummary[] {
  const root = getStorage().root;
  ensureDir(root);
  const result: ProjectSummary[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const meta = readMeta(dir);
    if (!meta) continue; // carpeta ajena o project.json dañado
    result.push({
      name: entry.name,
      createdAt: meta.createdAt,
      hasPuml: meta.pumlFile !== null && fs.existsSync(path.join(dir, meta.pumlFile))
    });
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function readProject(rawName: string): ProjectInfo {
  const name = assertValidName(rawName);
  const dir = path.join(getStorage().root, name);
  const meta = readMeta(dir);
  if (!meta) throw new Error(`El proyecto "${name}" no existe o su project.json está dañado.`);
  return { meta: { ...meta, name }, dir, puml: readPumlInfo(dir, meta) };
}

export function createProject(rawName: string): ProjectInfo {
  const name = assertValidName(rawName);
  ensureDir(getStorage().root);
  const existing = findExisting(name);
  if (existing) throw new Error(`Ya existe un proyecto llamado "${existing}".`);
  const dir = path.join(getStorage().root, name);
  fs.mkdirSync(dir); // sin recursive: falla si apareció entre medias
  writeMeta(dir, {
    name,
    createdAt: new Date().toISOString(),
    pumlFile: null,
    originalFileName: null,
    pumlLoadedAt: null
  });
  currentProject = name;
  return readProject(name);
}

export function openProject(rawName: string): ProjectInfo {
  const project = readProject(rawName);
  currentProject = project.meta.name;
  return project;
}

export function getCurrentProjectName(): string | null {
  return currentProject;
}

export function getCurrentProject(): ProjectInfo | null {
  if (!currentProject) return null;
  try {
    return readProject(currentProject);
  } catch {
    return null;
  }
}

/** Copia el .puml (ya validado) a diagram.puml de forma atómica y actualiza project.json. */
export function savePuml(rawName: string, sourcePath: string): ProjectInfo {
  const project = readProject(rawName);
  const target = path.join(project.dir, PUML_FILE);
  const tmp = `${target}.tmp`;
  fs.copyFileSync(sourcePath, tmp);
  fs.renameSync(tmp, target);
  writeMeta(project.dir, {
    ...project.meta,
    pumlFile: PUML_FILE,
    originalFileName: path.basename(sourcePath),
    pumlLoadedAt: new Date().toISOString()
  });
  return readProject(project.meta.name);
}

/** Guarda el texto actual del renderer como diagram.puml y lo asigna al proyecto. */
export function savePumlText(rawName: string, source: string): ProjectInfo {
  const project = readProject(rawName);
  const target = path.join(project.dir, PUML_FILE);
  atomicWrite(target, source.replace(/^\uFEFF/, ''));
  writeMeta(project.dir, {
    ...project.meta,
    pumlFile: PUML_FILE,
    originalFileName: project.puml?.originalFileName ?? `${project.meta.name}.puml`,
    pumlLoadedAt: new Date().toISOString()
  });
  return readProject(project.meta.name);
}

export function readPumlText(rawName: string): string {
  const project = readProject(rawName);
  if (!project.meta.pumlFile) throw new Error('Este proyecto todavía no tiene un .puml cargado.');
  const file = path.join(project.dir, project.meta.pumlFile);
  if (!fs.existsSync(file)) throw new Error(`No se encontró "${project.meta.pumlFile}" en la carpeta del proyecto.`);
  return fs.readFileSync(file, 'utf8');
}
