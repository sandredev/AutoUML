import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  SIDECAR_PROJECT_FILE,
  SIDECAR_VERSION,
  readSidecarFile,
  sidecarPathForFile,
  sidecarPathForProject,
  validateSidecar,
  writeSidecarFile,
} from '../../../src/infrastructure/storage/sidecar';
import type { SidecarState } from '../../../src/application/ports/ipc';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autouml-sidecar-'));

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function validState(): SidecarState {
  return { version: 1, collapsed: ['pkg_a'], overrides: { A: { dx: 10, dy: -4 } }, view: { scale: 1.5, tx: 20, ty: 30 } };
}

describe('sidecar paths', () => {
  it('proyecto usa layout.json y externos cambian la extensión', () => {
    expect(sidecarPathForProject('/p/mi-proyecto')).toBe(path.join('/p/mi-proyecto', SIDECAR_PROJECT_FILE));
    expect(SIDECAR_PROJECT_FILE).toBe('layout.json');
    expect(SIDECAR_VERSION).toBe(1);
    expect(sidecarPathForFile('/p/notas.puml')).toBe(path.join('/p', 'notas.autouml.json'));
    expect(sidecarPathForFile('/p/diagram.plantuml')).toBe(path.join('/p', 'diagram.autouml.json'));
  });
});

describe('validateSidecar', () => {
  it('acepta un estado válido y rechaza versión, tipos y NaN', () => {
    expect(validateSidecar(validState())).toEqual(validState());
    expect(validateSidecar({ ...validState(), version: 2 })).toBeNull();
    expect(validateSidecar({ ...validState(), collapsed: 'pkg' })).toBeNull();
    expect(validateSidecar({ ...validState(), overrides: { A: { dx: Number.NaN, dy: 0 } } })).toBeNull();
    expect(validateSidecar({ ...validState(), view: { scale: 0, tx: 0, ty: 0 } })).toBeNull();
    expect(validateSidecar(null)).toBeNull();
    expect(validateSidecar({ version: 1, collapsed: [], overrides: {}, view: null })).not.toBeNull();
  });
});

describe('round-trip en disco', () => {
  it('guarda y lee el mismo estado con escritura atómica', () => {
    const file = path.join(tmpRoot, 'layout.json');
    writeSidecarFile(file, validState());
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(readSidecarFile(file)).toEqual({ state: validState(), corrupt: false });
  });

  it('ausente es null sin corrupto; corrupto avisa sin lanzar', () => {
    expect(readSidecarFile(path.join(tmpRoot, 'no-existe.json'))).toEqual({ state: null, corrupt: false });
    const bad = path.join(tmpRoot, 'roto.json');
    fs.writeFileSync(bad, '{no es json', 'utf8');
    expect(readSidecarFile(bad)).toEqual({ state: null, corrupt: true });
    const wrong = path.join(tmpRoot, 'version.json');
    fs.writeFileSync(wrong, JSON.stringify({ version: 99 }), 'utf8');
    expect(readSidecarFile(wrong)).toEqual({ state: null, corrupt: true });
  });
});
