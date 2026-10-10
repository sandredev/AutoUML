// Benchmark: npx tsx scripts/bench-layout.ts — primer layout (dagre) y ELK para 50/200/500 clases.
import type { DiagramModel, TypeNode } from '../src/domain/diagram/model';
import { computeLayout } from '../src/presentation/diagram/layout/layout';
import { computeElkLayout } from '../src/presentation/diagram/layout/elkLayout';

function synth(n: number): DiagramModel {
  const types: TypeNode[] = Array.from({ length: n }, (_, i) => ({
    id: 'C' + i, name: 'Clase' + i, packageName: '(default package)', declaredKind: 'class', category: 'class',
    isAbstract: false, isSealed: false, isExternal: false, implicit: false, stereotypes: [],
    attributes: [{ name: 'campo', type: 'String', visibility: '-', isStatic: false }],
    methods: [{ name: 'hacer', returnType: 'void', parameters: [], visibility: '+', isStatic: false, isAbstract: false }],
    constructors: [], enumConstants: [], line: i + 1,
  }));
  const relationships = types.slice(1).map((t, i) => ({
    source: t.id, target: 'C' + Math.floor(i / 3), type: i % 4 === 0 ? 'EXTENDS' as const : 'ASSOCIATION' as const, line: n + i,
  }));
  return { types, relationships, packages: [], summaryMode: false, issues: [], direction: 'TB' };
}

async function main(): Promise<void> {
  for (const n of [50, 200, 500]) {
    const m = synth(n);
    let t = performance.now();
    computeLayout(m);
    const dagreMs = performance.now() - t;
    t = performance.now();
    await computeElkLayout(m);
    console.log(`${n} clases: dagre ${dagreMs.toFixed(0)} ms · ELK ${(performance.now() - t).toFixed(0)} ms`);
  }
}

void main();
