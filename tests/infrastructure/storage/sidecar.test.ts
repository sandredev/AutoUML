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
  it('conserva los avisos ignorados (T11) y descarta lo que no es texto', () => {
    const ok = validateSidecar({ ...validState(), ignoredIssues: ['warning:!theme plain', 3, '', 'x'.repeat(600)] });
    expect(ok?.ignoredIssues).toEqual(['warning:!theme plain']);
    expect(validateSidecar({ ...validState(), ignoredIssues: [] })).toEqual(validState());
    expect(validateSidecar({ ...validState(), ignoredIssues: 'no' })).toEqual(validState());
  });

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

describe('filtros por documento (T8, opcionales y sin subir version)', () => {
  const filters = {
    hiddenRelTypes: ['DEPENDENCY'],
    minVisibility: '#',
    hideAccessors: true,
    hideConstructors: false,
    hideExternal: true,
    hideUndeclared: false,
    hiddenPackages: ['app.ui'],
    hiddenTypes: ['Logger'],
  };

  it('un sidecar antiguo sin filters sigue cargando y no inventa el campo', () => {
    const state = validateSidecar(validState());
    expect(state).toEqual(validState());
    expect(state && 'filters' in state).toBe(false);
  });

  it('acepta filters válidos y hace round-trip en disco', () => {
    const withFilters = { ...validState(), filters } as SidecarState;
    expect(validateSidecar(withFilters)).toEqual(withFilters);
    const file = path.join(tmpRoot, 'con-filtros.json');
    writeSidecarFile(file, withFilters);
    expect(readSidecarFile(file)).toEqual({ state: withFilters, corrupt: false });
  });

  it('un campo de filters inválido se descarta sin dar el sidecar por corrupto', () => {
    const raw = {
      ...validState(),
      filters: { hiddenRelTypes: ['DEPENDENCY', 'NO_EXISTE', 3], minVisibility: '!', hideAccessors: 'si', hiddenPackages: 'app', futuro: 1 },
    };
    expect(validateSidecar(raw)).toEqual({ ...validState(), filters: { hiddenRelTypes: ['DEPENDENCY'] } });
    expect(validateSidecar({ ...validState(), filters: 'roto' })).toEqual(validState());
  });
});

describe('vistas de presentación (T10, opcionales y sin subir version)', () => {
  const views = [
    { title: 'General', view: { scale: 0.5, tx: 10, ty: -4 } },
    { title: 'Dominio', view: { scale: 1, tx: 0, ty: 0 }, filters: { hideExternal: true }, focusKey: 'Order', collapsed: ['app.ui'] },
  ];

  it('un sidecar sin views no inventa el campo', () => {
    const state = validateSidecar(validState());
    expect(state && 'views' in state).toBe(false);
  });

  it('acepta views válidas y hace round-trip en disco', () => {
    const withViews = { ...validState(), views } as SidecarState;
    expect(validateSidecar(withViews)).toEqual(withViews);
    const file = path.join(tmpRoot, 'con-vistas.json');
    writeSidecarFile(file, withViews);
    expect(readSidecarFile(file)).toEqual({ state: withViews, corrupt: false });
  });

  it('una vista rota se descarta sin dar el sidecar por corrupto y sus filtros se validan igual que los globales', () => {
    const raw = {
      ...validState(),
      views: [views[0], { title: 'mala' }, { ...views[0], title: 'f', filters: { minVisibility: '!', hideExternal: true, futuro: 1 } }],
    };
    expect(validateSidecar(raw)).toEqual({
      ...validState(),
      views: [views[0], { ...views[0], title: 'f', filters: { hideExternal: true } }],
    });
    expect(validateSidecar({ ...validState(), views: 'roto' })).toEqual(validState());
  });
});
