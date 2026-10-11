// tests/domain/analysis/report.test.ts — informe Markdown del análisis: texto exacto y determinista (T9).
import { describe, expect, it } from 'vitest';
import { analyzeDiagram } from '../../../src/domain/analysis/analyze';
import { analysisReport } from '../../../src/domain/analysis/report';
import type { DiagramModel } from '../../../src/domain/diagram/model';
import { DEFAULT_LABELS } from '../../../src/presentation/diagram/labels';
import { diagram, rel, typeNode } from '../../helpers/diagramBuilders';

function demo(reverse = false): DiagramModel {
  const types = [
    typeNode('A', { packageName: 'app' }),
    typeNode('B', { packageName: 'domain' }),
    typeNode('C', { packageName: 'domain', name: 'Cosa|rara' }),
    typeNode('I', { packageName: 'domain', declaredKind: 'interface', category: 'interface' }),
    typeNode('S'),
  ];
  const rels = [rel('A', 'B'), rel('B', 'A'), rel('C', 'I', { type: 'IMPLEMENTS' }), rel('A', 'C'), rel('S', 'S')];
  const m = diagram(reverse ? [...types].reverse() : types, reverse ? [...rels].reverse() : rels);
  m.packages = [
    { name: 'app', typeIds: ['A'], layer: 'app' },
    { name: 'domain', typeIds: ['B', 'C', 'I'], layer: 'domain' },
    { name: '(default package)', typeIds: ['S'] },
  ];
  return m;
}

const EXPECTED = `# Demo: diagnóstico de arquitectura

5 tipos analizados · 4 dependencias. No incluye tipos externos ni sin declarar.

## Ciclos entre clases (1)

- A → B → A

## Ciclos entre paquetes (1)

- app → domain → app

## Autorreferencias (1)

- S

## Violaciones de capas (1)

Capas de arriba abajo (paquetes del diagrama): app → domain. Una capa superior puede depender de una inferior; depender de una capa superior es una violación.

| Origen | Capa | Destino | Capa |
| --- | --- | --- | --- |
| B | domain | A | app |

## Métricas

### Tipos por categoría

| Categoría | Tipos |
| --- | ---: |
| Interfaz | 1 |
| Clase | 4 |

### Herencia

Profundidad máxima: 1 (Cosa\\|rara → I)

### Clases más acopladas

| Clase | Ca (entrantes) | Ce (salientes) | I |
| --- | ---: | ---: | ---: |
| A | 1 | 2 | 0.67 |
| B | 1 | 1 | 0.50 |
| Cosa\\|rara | 1 | 1 | 0.50 |
| I | 1 | 0 | 0.00 |

### Paquetes

| Paquete | Tipos | Abstractos | Ca | Ce | I | A | D |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| (sin paquete) | 1 | 0 | 0 | 0 | 0.00 | 0.00 | 1.00 |
| app | 1 | 0 | 1 | 1 | 0.50 | 0.00 | 0.50 |
| domain | 3 | 1 | 1 | 1 | 0.50 | 0.33 | 0.17 |

Ca: acoplamiento aferente (cuántas clases dependen de esta). Ce: eferente (de cuántas depende). I = Ce / (Ca + Ce). A = tipos abstractos / tipos. D = |A + I − 1|.
`;

describe('analysisReport', () => {
  it('genera el Markdown esperado (nombres visibles, | escapado, cifras con 2 decimales)', () => {
    const m = demo();
    expect(analysisReport(m, analyzeDiagram(m), DEFAULT_LABELS.analysis, 'Demo')).toBe(EXPECTED);
  });

  it('es determinista: no depende del orden de declaración', () => {
    const m = demo(true);
    expect(analysisReport(m, analyzeDiagram(m), DEFAULT_LABELS.analysis, 'Demo')).toBe(EXPECTED);
  });

  it('sin hallazgos ni capas: secciones con "Ninguno." y aviso de capas', () => {
    const m = diagram([typeNode('A')]);
    const md = analysisReport(m, analyzeDiagram(m), DEFAULT_LABELS.analysis, 'X');
    expect(md).toContain('## Ciclos entre clases (0)\n\nNinguno.\n');
    expect(md).toContain('## Violaciones de capas (0)\n\nEl diagrama no define capas');
    expect(md).toContain('Profundidad máxima: 0\n');
    expect(md).not.toContain('### Clases más acopladas');
  });
});
