import { describe, expect, it } from 'vitest';
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
