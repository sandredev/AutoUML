import { describe, expect, it } from 'vitest';
import type { DiagramModel, TypeNode } from '../../core/model';
import type { LayoutResult } from '../types';
import { computeElkLayout, runLayoutWithFallback } from './elkLayout';

function t(id: string, declaredKind: TypeNode['declaredKind'] = 'class'): TypeNode {
  return {
    id, name: id, packageName: '', declaredKind,
    category: declaredKind === 'interface' ? 'interface' : 'class',
    isAbstract: false, isSealed: false, isExternal: false, implicit: false,
    stereotypes: [], attributes: [], methods: [], constructors: [], enumConstants: [], line: 1,
  };
}

function model(): DiagramModel {
  return {
    types: [t('Padre'), t('Hijo'), t('IFace', 'interface')],
    relationships: [
      { source: 'Hijo', target: 'Padre', type: 'EXTENDS', line: 1 },
      { source: 'Hijo', target: 'IFace', type: 'IMPLEMENTS', line: 2 },
    ],
    packages: [],
    summaryMode: false,
    issues: [],
  };
}

describe('computeElkLayout', () => {
  it('padre encima del hijo en TB', async () => {
    const r = await computeElkLayout(model());
    const p = r.nodes.find((n) => n.id === 'Padre');
    const h = r.nodes.find((n) => n.id === 'Hijo');
    expect(p && h).toBeTruthy();
    expect((p?.y ?? 0) + (p?.h ?? 0)).toBeLessThanOrEqual(h?.y ?? 0);
  });

  it('aristas con ≥4 números finitos', async () => {
    const r = await computeElkLayout(model());
    expect(r.edges.length).toBe(2);
    for (const e of r.edges) {
      expect(e.points.length).toBeGreaterThanOrEqual(4);
      expect(e.points.every(Number.isFinite)).toBe(true);
    }
  });
});

describe('runLayoutWithFallback', () => {
  it('si ELK lanza, cae a dagre con fallback visible', async () => {
    const r = await runLayoutWithFallback(model(), undefined, {
      elk: () => Promise.reject(new Error('boom')),
    });
    expect(r.engine).toBe('dagre');
    expect(r.fallback).toBeTruthy();
    expect(r.result.nodes.length).toBe(3);
  });

  it('timeout de ELK también cae a dagre', async () => {
    const r = await runLayoutWithFallback(model(), undefined, {
      elk: () => new Promise<LayoutResult>(() => undefined),
      timeoutMs: 20,
    });
    expect(r.engine).toBe('dagre');
    expect(r.fallback).toContain('20');
  });
});
