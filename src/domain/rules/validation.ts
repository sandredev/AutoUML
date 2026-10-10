// Validaciones puras, compartidas por main (autoridad final) y renderer (feedback inmediato).

export const MAX_PROJECT_NAME_LENGTH = 64;
const INVALID_NAME_CHARS = /[\/\\:*?"<>|]/;
const CONTROL_CHARS = /[\u0000-\u001f]/;
const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Devuelve un mensaje de error, o null si el nombre es válido. No comprueba duplicados. */
export function validateProjectName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) return 'El nombre no puede estar vacío.';
  if (name.length > MAX_PROJECT_NAME_LENGTH) {
    return `El nombre admite como máximo ${MAX_PROJECT_NAME_LENGTH} caracteres.`;
  }
  if (INVALID_NAME_CHARS.test(name)) return 'El nombre no puede contener / \\ : * ? " < > |';
  if (CONTROL_CHARS.test(name)) return 'El nombre no puede contener caracteres de control.';
  if (name === '.' || name === '..' || /[. ]$/.test(name)) {
    return 'El nombre no puede terminar en punto ni en espacio.';
  }
  if (RESERVED_WINDOWS.test(name)) return `"${name}" es un nombre reservado del sistema.`;
  return null;
}

export const PUML_EXTENSIONS = ['.puml', '.plantuml', '.pu'] as const;

export function hasPumlExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return PUML_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Comprueba @startuml / @enduml. Devuelve la lista de errores (vacía = válido). */
export function validatePumlMarkers(text: string): string[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  let start = -1;
  let end = -1;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (start < 0 && /^@startuml\b/i.test(t)) start = i;
    if (/^@enduml\b/i.test(t)) end = i;
  });
  const errors: string[] = [];
  if (start < 0) errors.push('Falta la línea @startuml.');
  if (end < 0) errors.push('Falta la línea @enduml.');
  if (start >= 0 && end >= 0 && end < start) {
    errors.push(`@enduml (línea ${end + 1}) aparece antes de @startuml (línea ${start + 1}).`);
  }
  return errors;
}
