// tests/infrastructure/storage/layersConfig.test.ts — layers.json junto al .puml (T9).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  LAYERS_FILE,
  layersPathForFile,
  layersPathForProject,
  readLayersFile,
  validateLayers,
} from '../../../src/infrastructure/storage/layersConfig';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autouml-layers-'));
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

describe('rutas de layers.json', () => {
  it('en la carpeta del proyecto, o junto al .puml externo', () => {
    expect(LAYERS_FILE).toBe('layers.json');
    expect(layersPathForProject('/p/proy')).toBe(path.join('/p/proy', 'layers.json'));
    expect(layersPathForFile(path.join('/docs', 'arq.puml'))).toBe(path.join('/docs', 'layers.json'));
  });
});

describe('validateLayers', () => {
  it('acepta { layers: [...] } o una lista suelta, de arriba abajo', () => {
    expect(validateLayers({ layers: ['ui', 'app', 'domain'] })).toEqual(['ui', 'app', 'domain']);
    expect(validateLayers(['ui', 'domain'])).toEqual(['ui', 'domain']);
  });

  it('recorta, descarta vacíos, no-texto y repetidos', () => {
    expect(validateLayers({ layers: [' ui ', '', 3, 'ui', 'app'] })).toEqual(['ui', 'app']);
  });

  it('null si no es una lista de capas', () => {
    expect(validateLayers({ capas: ['x'] })).toBeNull();
    expect(validateLayers('ui')).toBeNull();
    expect(validateLayers({ layers: [] })).toBeNull();
  });
});

describe('readLayersFile', () => {
  it('ausente: sin capas y sin aviso', () => {
    expect(readLayersFile(path.join(tmpRoot, 'no-existe.json'))).toEqual({ layers: null, corrupt: false });
  });

  it('válido', () => {
    const f = path.join(tmpRoot, 'ok.json');
    fs.writeFileSync(f, JSON.stringify({ layers: ['ui', 'domain'] }), 'utf8');
    expect(readLayersFile(f)).toEqual({ layers: ['ui', 'domain'], corrupt: false });
  });

  it('JSON roto o con forma inválida: sin capas y con aviso', () => {
    const roto = path.join(tmpRoot, 'roto.json');
    fs.writeFileSync(roto, '{ layers: [', 'utf8');
    expect(readLayersFile(roto)).toEqual({ layers: null, corrupt: true });
    const raro = path.join(tmpRoot, 'raro.json');
    fs.writeFileSync(raro, '{"layers": "ui"}', 'utf8');
    expect(readLayersFile(raro)).toEqual({ layers: null, corrupt: true });
  });

  it('tolera BOM', () => {
    const f = path.join(tmpRoot, 'bom.json');
    fs.writeFileSync(f, '﻿["a","b"]', 'utf8');
    expect(readLayersFile(f).layers).toEqual(['a', 'b']);
  });
});
