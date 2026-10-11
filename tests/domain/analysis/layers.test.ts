// tests/domain/analysis/layers.test.ts — orden de capas y dependencias hacia arriba (T9).
import { describe, expect, it } from 'vitest';
import { findLayerViolations, layerIndexOf, resolveLayers } from '../../../src/domain/analysis/layers';
import { buildDependencyGraph } from '../../../src/domain/analysis/graph';
import type { DiagramModel } from '../../../src/domain/diagram/model';
import { diagram, rel, typeNode } from '../../helpers/diagramBuilders';

/** Modelo con capas del generador: ui (arriba) → app → domain (abajo), por orden de aparición. */
function layered(rels: Array<[string, string]>): DiagramModel {
  const m = diagram(
    [
      typeNode('View', { packageName: 'ui.views' }),
      typeNode('Svc', { packageName: 'app.services' }),
      typeNode('Svc2', { packageName: 'app.services' }),
      typeNode('Entity', { packageName: 'domain.model' }),
      typeNode('Util'),
    ],
    rels.map(([a, b]) => rel(a, b)),
  );
  m.packages = [
    { name: 'ui', typeIds: [] },
    { name: 'ui.views', typeIds: ['View'], layer: 'ui' },
    { name: 'app.services', typeIds: ['Svc', 'Svc2'], layer: 'app' },
    { name: 'domain.model', typeIds: ['Entity'], layer: 'domain' },
    { name: '(default package)', typeIds: ['Util'] },
  ];
  return m;
}

describe('resolveLayers', () => {
  it('por defecto: orden de aparición de PackageModel.layer (la primera es la SUPERIOR)', () => {
    expect(resolveLayers(layered([]))).toEqual({ order: ['ui', 'app', 'domain'], source: 'model' });
  });

  it('layers.json manda si trae capas', () => {
    expect(resolveLayers(layered([]), ['domain', 'app'])).toEqual({ order: ['domain', 'app'], source: 'config' });
    expect(resolveLayers(layered([]), [])).toMatchObject({ source: 'model' });
  });

  it('sin capas en el modelo ni configuración: ninguna', () => {
    expect(resolveLayers(diagram([typeNode('A')]))).toEqual({ order: [], source: 'none' });
  });
});

describe('layerIndexOf', () => {
  it('por el campo layer del paquete, o por nombre/prefijo de paquete (gana el más específico)', () => {
    const m = diagram([
      typeNode('A', { packageName: 'com.app.ui' }),
      typeNode('B', { packageName: 'com.app' }),
      typeNode('C', { packageName: 'com.other' }),
    ]);
    const idx = layerIndexOf(m, ['com.app', 'com.app.ui']);
    expect(idx.get('A')).toBe(1);
    expect(idx.get('B')).toBe(0);
    expect(idx.has('C')).toBe(false);
  });
});

describe('findLayerViolations', () => {
  const run = (m: DiagramModel) => findLayerViolations(buildDependencyGraph(m), layerIndexOf(m, resolveLayers(m).order));

  it('sin violaciones: las superiores dependen de las inferiores', () => {
    expect(run(layered([['View', 'Svc'], ['Svc', 'Entity']]))).toEqual([]);
  });

  it('una violación: dependencia hacia arriba (domain → app)', () => {
    expect(run(layered([['Entity', 'Svc'], ['View', 'Svc']]))).toEqual([
      { source: 'Entity', target: 'Svc', sourceLayer: 2, targetLayer: 1 },
    ]);
  });

  it('dentro de la misma capa no es violación', () => {
    expect(run(layered([['Svc', 'Svc2'], ['Svc2', 'Svc']]))).toEqual([]);
  });

  it('un tipo sin capa no participa', () => {
    expect(run(layered([['Util', 'View'], ['Entity', 'Util']]))).toEqual([]);
  });
});
