import { describe, expect, it } from 'vitest';
import type { RelationshipModel } from '../../../src/domain/diagram/model';
import { labelAnchor } from '../../../src/presentation/diagram/canvas/edgePath';
import { placeEdgeLabels } from '../../../src/presentation/diagram/edgeLabels';
import { diagramToSvg } from '../../../src/presentation/diagram/svg';
import type { LayoutResult } from '../../../src/presentation/diagram/types';

function layout(): LayoutResult {
  return {
    nodes: [
      { id: 'A&B', x: 10, y: 10, w: 120, h: 60, packageName: 'p' },
      { id: 'B', x: 200, y: 10, w: 120, h: 60, packageName: 'p' },
    ],
    edges: [
      { source: 'A&B', target: 'B', type: 'ASSOCIATION', points: [130, 40, 200, 40] },
      { source: 'B', target: 'A&B', type: 'DEPENDENCY', points: [200, 60, 130, 60] },
    ],
    packages: [{ name: 'p', x: 0, y: 0, w: 330, h: 80 }],
    notes: [{ id: 'n1', x: 10, y: 100, w: 100, h: 40, lines: ['hola'], anchor: 'A&B' }],
    bounds: { x: 0, y: 0, w: 330, h: 140 },
  };
}

describe('diagramToSvg', () => {
  it('emite un SVG válido con tarjetas, aristas y notas', () => {
    const { svg, width, height } = diagramToSvg(layout(), {
      cards: new Map([['A&B', { name: 'A&B', members: ['+x: int'] }], ['B', { name: 'B', members: [] }]]),
    });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('A&amp;B');
    expect(svg).not.toContain('A&B');
    expect(svg).toContain('+x: int');
    expect(svg).toContain('hola');
    // Un path por arista (más los de las notas con doblez).
    expect(svg.split('<path').length - 1).toBeGreaterThanOrEqual(2);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it('fondo transparente si se pide y título opcional', () => {
    const withBg = diagramToSvg(layout());
    expect(withBg.svg).toContain('<rect');
    const transparent = diagramToSvg(layout(), { background: null, title: 'Mi diagrama' });
    expect(transparent.svg).toContain('<title>Mi diagrama</title>');
    // Sin rect de fondo: solo los rects de tarjetas/paquetes/notas.
    const bgCount = (withBg.svg.match(/<rect/g) ?? []).length;
    const noBgCount = (transparent.svg.match(/<rect/g) ?? []).length;
    expect(noBgCount).toBe(bgCount - 1);
  });
});

describe('diagramToSvg: relaciones como en el lienzo', () => {
  const rels: RelationshipModel[] = [
    { source: 'B', target: 'A&B', type: 'EXTENDS', line: 1 },
    { source: 'B', target: 'A&B', type: 'DEPENDENCY', label: 'usa', targetLabel: '0..*', line: 2 },
  ];
  const l: LayoutResult = {
    ...layout(),
    edges: [
      { source: 'B', target: 'A&B', type: 'EXTENDS', points: [200, 40, 130, 40], routing: 'orthogonal', rel: 0 },
      { source: 'B', target: 'A&B', type: 'DEPENDENCY', points: [260, 70, 260, 90, 70, 90, 70, 70], routing: 'orthogonal', rel: 1, label: 'usa' },
    ],
  };

  it('dibuja la cabeza de cada tipo y la línea discontinua de las dependencias', () => {
    const { svg } = diagramToSvg(l, { relationships: rels });
    // Herencia: triángulo cerrado con fondo; dependencia: flecha abierta y trazo discontinuo.
    expect(svg).toMatch(/<polygon points="[^"]+" fill="#ffffff"/);
    expect(svg).toMatch(/<polyline points="[^"]+" fill="none"/);
    expect(svg.match(/stroke-dasharray="6 4"/g)).toHaveLength(1);
  });

  it('escribe la etiqueta y la multiplicidad con caja de fondo', () => {
    const { svg } = diagramToSvg(l, { relationships: rels });
    expect(svg).toContain('>usa</text>');
    expect(svg).toContain('>0..*</text>');
    expect(svg).toContain('text-anchor="middle"');
  });
});

describe('placeEdgeLabels', () => {
  it('no pone la etiqueta sobre una tarjeta si la arista tiene un tramo libre', () => {
    // El tramo más largo pasa a 5px por debajo de C: en su centro la etiqueta taparía la tarjeta.
    const lay = {
      nodes: [
        { id: 'A', x: 0, y: 0, w: 60, h: 40 },
        { id: 'B', x: 400, y: 200, w: 60, h: 40 },
        { id: 'C', x: 50, y: 60, w: 300, h: 100 },
      ],
      packages: [],
      edges: [{ source: 'A', target: 'B', type: 'ASSOCIATION' as const, points: [30, 40, 30, 165, 430, 165, 430, 200], routing: 'orthogonal' as const }],
    };
    const spots = placeEdgeLabels(lay, () => ({ label: 'una etiqueta larga' }), (t) => t.length * 6);
    const at = spots.get(0)?.label;
    expect(at).toBeDefined();
    if (!at) return;
    const w = 'una etiqueta larga'.length * 6 + 4;
    const c = lay.nodes[2]!;
    const overlaps = at.x + w / 2 > c.x && at.x - w / 2 < c.x + c.w && at.y + 9 > c.y && at.y - 9 < c.y + c.h;
    expect(overlaps).toBe(false);
    // Con el anclaje anterior (centro del tramo más largo) sí la tapaba.
    const old = labelAnchor(lay.edges[0]!.points)!;
    expect(old.y + 9 > c.y && old.y - 9 < c.y + c.h).toBe(true);
  });

  it('dos etiquetas de aristas paralelas no se pisan', () => {
    const lay = {
      nodes: [],
      packages: [],
      edges: [
        { source: 'A', target: 'B', type: 'ASSOCIATION' as const, points: [0, 0, 300, 0], routing: 'orthogonal' as const },
        { source: 'A', target: 'B', type: 'ASSOCIATION' as const, points: [0, 10, 300, 10], routing: 'orthogonal' as const },
      ],
    };
    const spots = placeEdgeLabels(lay, () => ({ label: 'texto' }), (t) => t.length * 6);
    const a = spots.get(0)?.label;
    const b = spots.get(1)?.label;
    expect(a && b).toBeTruthy();
    if (!a || !b) return;
    const w = 'texto'.length * 6 + 4;
    expect(Math.abs(a.x - b.x) >= w || Math.abs(a.y - b.y) >= 18).toBe(true);
  });
});
