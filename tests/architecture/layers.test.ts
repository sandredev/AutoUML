// Regla de dependencia de Clean Architecture: las capas internas no conocen a las externas.
//   domain  <-  application  <-  infrastructure | presentation
// infrastructure (Electron/Node) y presentation (React/DOM) tampoco se conocen entre sí.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type Layer = 'domain' | 'application' | 'infrastructure' | 'presentation';

const SRC = path.resolve(__dirname, '../../src');

const ALLOWED_LAYERS: Record<Layer, Layer[]> = {
  domain: ['domain'],
  application: ['domain', 'application'],
  infrastructure: ['domain', 'application', 'infrastructure'],
  presentation: ['domain', 'application', 'presentation'],
};

/** Paquetes externos prohibidos por capa (prefijos). */
const FORBIDDEN_PACKAGES: Record<Layer, string[]> = {
  domain: ['electron', 'react', 'node:', 'fs', 'path', 'elkjs', '@dagrejs'],
  application: ['electron', 'react', 'node:', 'fs', 'path', 'elkjs', '@dagrejs'],
  infrastructure: ['react'],
  presentation: ['electron', 'node:', 'fs', 'path'],
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function layerOf(file: string): Layer {
  return path.relative(SRC, file).split(path.sep)[0] as Layer;
}

function importsOf(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const specs: string[] = [];
  for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)(['"])([^'"]+)\1/g)) specs.push(m[2]);
  return specs;
}

const files = sourceFiles(SRC);

describe('arquitectura en capas', () => {
  it('el repo tiene exactamente las cuatro capas', () => {
    const layers = new Set(files.map(layerOf));
    expect([...layers].sort()).toEqual(['application', 'domain', 'infrastructure', 'presentation']);
  });

  it('ninguna capa importa de una capa externa a ella', () => {
    const violations: string[] = [];
    for (const file of files) {
      const layer = layerOf(file);
      for (const spec of importsOf(file)) {
        if (!spec.startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), spec.replace(/\?.*$/, ''));
        const rel = path.relative(SRC, target);
        if (rel.startsWith('..')) continue;
        const targetLayer = rel.split(path.sep)[0] as Layer;
        if (!ALLOWED_LAYERS[layer].includes(targetLayer)) {
          violations.push(`${path.relative(SRC, file)} (${layer}) -> ${spec} (${targetLayer})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('domain y application no dependen de frameworks ni de Node', () => {
    const violations: string[] = [];
    for (const file of files) {
      const layer = layerOf(file);
      for (const spec of importsOf(file)) {
        if (spec.startsWith('.')) continue;
        const pkg = spec.split('/')[0];
        if (FORBIDDEN_PACKAGES[layer].some((p) => spec === p || spec.startsWith(p) || pkg === p)) {
          violations.push(`${path.relative(SRC, file)} (${layer}) -> ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
