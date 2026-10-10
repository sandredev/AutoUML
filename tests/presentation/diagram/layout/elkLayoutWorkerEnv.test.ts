// Simula el entorno de un Web Worker (hay `self`, no hay `document`).
// Así es como elk.bundled.js fallaba dentro del Worker real ("_Worker is not a constructor")
// y la app terminaba siempre con dagre. Este archivo se ejecuta aislado (vitest aísla por archivo).
import { describe, expect, it } from 'vitest';
import type { DiagramModel, TypeNode } from '../../../../src/domain/diagram/model';

const g = globalThis as { self?: unknown; document?: unknown };

function t(id: string): TypeNode {
  return {
    id, name: id, packageName: '', declaredKind: 'class', category: 'class',
    isAbstract: false, isSealed: false, isExternal: false, implicit: false,
    stereotypes: [], attributes: [], methods: [], constructors: [], enumConstants: [], line: 1,
  };
}

describe('ELK dentro de un Worker', () => {
  it('usa ELK (no cae a dagre) cuando existe self y no existe document', async () => {
    g.self = globalThis;
    expect(typeof g.document).toBe('undefined');
    const { runLayoutWithFallback } = await import('../../../../src/presentation/diagram/layout/elkLayout');
    const model: DiagramModel = {
      types: [t('A'), t('B')],
      relationships: [{ source: 'B', target: 'A', type: 'EXTENDS', line: 1 }],
      packages: [],
      summaryMode: false,
      issues: [],
    };
    const r = await runLayoutWithFallback(model);
    expect(r.fallback).toBeUndefined();
    expect(r.engine).toBe('elk');
    expect(r.result.edges.length).toBe(1);
    // El document temporal no debe quedarse puesto.
    expect(typeof g.document).toBe('undefined');
  });
});
