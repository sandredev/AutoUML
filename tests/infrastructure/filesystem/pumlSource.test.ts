import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadSourceWithIncludes, saveEntryText } from '../../../src/infrastructure/filesystem/pumlSource';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autouml-pumlsource-'));

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeTree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'doc-'));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  return dir;
}

describe('loadSourceWithIncludes', () => {
  it('carga simple sin includes con tmp real', () => {
    const dir = writeTree({ 'main.puml': '@startuml\nclass A\n@enduml\n' });
    const r = loadSourceWithIncludes(path.join(dir, 'main.puml'));
    expect(r.entryText).toContain('class A');
    expect(r.text).toContain('class A');
    // En win32 la ruta normaliza a minúsculas (F.2): se compara sin case.
    expect(r.files).toHaveLength(1);
    expect(r.files[0]?.toLowerCase()).toBe(path.join(dir, 'main.puml').toLowerCase());
    expect(r.issues).toEqual([]);
    expect(r.lineMap).toHaveLength(r.text.split('\n').length);
  });

  it('expande anidados y registra files para vigilar', () => {
    const dir = writeTree({
      'main.puml': '@startuml\n!include sub/b.puml\nclass A\n@enduml',
      'sub/b.puml': 'class B',
    });
    const r = loadSourceWithIncludes(path.join(dir, 'main.puml'));
    expect(r.text).toContain('class B');
    expect(r.text).toContain('class A');
    expect(r.text).not.toContain('!include');
    expect(r.files.map((f) => path.basename(f))).toEqual(['main.puml', 'b.puml']);
  });

  it('ciclo y faltante no tumban: hay issues y se sigue', () => {
    const dir = writeTree({
      'a.puml': 'class A\n!include b.puml',
      'b.puml': 'class B\n!include a.puml',
      'm.puml': 'class M\n!include nope.puml\nclass N',
    });
    const ciclo = loadSourceWithIncludes(path.join(dir, 'a.puml'));
    expect(ciclo.issues.some((i) => i.severity === 'error' && i.message.includes('Ciclo'))).toBe(true);
    expect(ciclo.text).toContain('class A');
    const falta = loadSourceWithIncludes(path.join(dir, 'm.puml'));
    expect(falta.issues.some((i) => i.severity === 'warning' && i.message.includes('nope.puml'))).toBe(true);
    expect(falta.text).toContain('class N');
  });

  it('en win32 la entrada normaliza a minúsculas', () => {
    const dir = writeTree({ 'Main.PUML': '@startuml\nclass A\n@enduml' });
    const upper = path.join(dir, 'Main.PUML');
    const r = loadSourceWithIncludes(upper);
    if (process.platform === 'win32') {
      expect(r.entryPath).toBe(path.normalize(upper).toLowerCase());
    } else {
      expect(r.entryPath).toBe(upper);
    }
  });
});

describe('loadSourceWithIncludes con el texto del editor (T7)', () => {
  it('usa el texto en memoria para la entrada y lee los incluidos del disco', () => {
    const dir = writeTree({
      'main.puml': '@startuml\nclass Viejo\n@enduml',
      'inc.iuml': 'class Incluido',
    });
    const live = '@startuml\n!include inc.iuml\nclass Nuevo\n@enduml';
    const r = loadSourceWithIncludes(path.join(dir, 'main.puml'), live);
    expect(r.entryText).toBe(live);
    expect(r.text).toContain('class Nuevo');
    expect(r.text).toContain('class Incluido');
    expect(r.text).not.toContain('class Viejo');
    expect(r.files).toHaveLength(2);
  });

  it('el disco no cambia: es solo para parsear', () => {
    const dir = writeTree({ 'main.puml': '@startuml\nclass A\n@enduml' });
    loadSourceWithIncludes(path.join(dir, 'main.puml'), '@startuml\nclass B\n@enduml');
    expect(fs.readFileSync(path.join(dir, 'main.puml'), 'utf8')).toBe('@startuml\nclass A\n@enduml');
  });
});

describe('saveEntryText (T7: Ctrl+S de un archivo externo)', () => {
  it('escribe el texto tal cual, sin BOM y sin dejar el temporal', () => {
    const dir = writeTree({ 'main.puml': '@startuml\nclass A\n@enduml' });
    const file = path.join(dir, 'main.puml');
    saveEntryText(file, '﻿@startuml\r\nclass B\r\n@enduml');
    expect(fs.readFileSync(file, 'utf8')).toBe('@startuml\r\nclass B\r\n@enduml');
    expect(fs.readdirSync(dir)).toEqual(['main.puml']);
  });

  it('no crea archivos nuevos: la entrada debe existir', () => {
    const dir = writeTree({});
    expect(() => saveEntryText(path.join(dir, 'nuevo.puml'), '@startuml\n@enduml')).toThrow();
    expect(fs.existsSync(path.join(dir, 'nuevo.puml'))).toBe(false);
  });
});
