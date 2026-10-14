// tests/presentation/diagram/routing/orthoRouter.test.ts — tests TDD de ruteo ortogonal y paquetes (puro, sin DOM/React).
import { describe, expect, it } from 'vitest';
import { simplify } from '../../../../src/presentation/diagram/canvas/edgePath';
import { applyOverrides, moveBy } from '../../../../src/presentation/diagram/canvas/overrides';
import {
  distToBoxBorder,
  EPS,
  fitPackageBoxes,
  openPackageChannels,
  PKG_PAD,
  routeAllEdges,
} from '../../../../src/presentation/diagram/routing';
import type { EdgePath, LayoutResult, NodeBox, PackageBox } from '../../../../src/presentation/diagram/types';

function assertOrthogonalAndTouching(edge: EdgePath, src: NodeBox, tgt: NodeBox): void {
  expect(edge.routing).toBe('orthogonal');
  expect(edge.points.length).toBeGreaterThanOrEqual(4);
  expect(edge.points.length % 2).toBe(0);
  for (const v of edge.points) expect(Number.isFinite(v)).toBe(true);

  const n = edge.points.length / 2;
  for (let i = 0; i < n - 1; i++) {
    const dx = Math.abs((edge.points[(i + 1) * 2] ?? 0) - (edge.points[i * 2] ?? 0));
    const dy = Math.abs((edge.points[(i + 1) * 2 + 1] ?? 0) - (edge.points[i * 2 + 1] ?? 0));
    expect(dx < EPS || dy < EPS).toBe(true);
  }

  const sx = edge.points[0] ?? 0;
  const sy = edge.points[1] ?? 0;
  const tx = edge.points[(n - 1) * 2] ?? 0;
  const ty = edge.points[(n - 1) * 2 + 1] ?? 0;
  expect(distToBoxBorder(src, sx, sy)).toBeLessThan(1);
  expect(distToBoxBorder(tgt, tx, ty)).toBeLessThan(1);

  // Idempotencia de simplify
  expect(simplify(edge.points)).toEqual(edge.points);
}

describe('ortho router y ajuste de paquetes', () => {
  it('enruta evitando una tarjeta intermedia y cumple invariantes de ortogonalidad y determinismo', () => {
    const nodes: NodeBox[] = [
      { id: 'A', x: 100, y: 40, w: 120, h: 60 },
      { id: 'B', x: 100, y: 160, w: 120, h: 60 }, // obstáculo justo en medio
      { id: 'C', x: 100, y: 280, w: 120, h: 60 },
    ];
    const baseEdges: EdgePath[] = [
      { source: 'A', target: 'C', type: 'ASSOCIATION', points: [], routing: 'orthogonal', rel: 0 },
    ];

    const r1 = routeAllEdges(nodes, [], baseEdges);
    const r2 = routeAllEdges(nodes, [], baseEdges);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));

    const edge = r1[0];
    expect(edge).toBeDefined();
    if (!edge) return;
    assertOrthogonalAndTouching(edge, nodes[0]!, nodes[2]!);

    // Ningún tramo atraviesa la caja central B
    const b = nodes[1]!;
    const n = edge.points.length / 2;
    for (let i = 0; i < n - 1; i++) {
      const x0 = Math.min(edge.points[i * 2] ?? 0, edge.points[(i + 1) * 2] ?? 0);
      const x1 = Math.max(edge.points[i * 2] ?? 0, edge.points[(i + 1) * 2] ?? 0);
      const y0 = Math.min(edge.points[i * 2 + 1] ?? 0, edge.points[(i + 1) * 2 + 1] ?? 0);
      const y1 = Math.max(edge.points[i * 2 + 1] ?? 0, edge.points[(i + 1) * 2 + 1] ?? 0);
      const hitsB = x1 > b.x + 2 && x0 < b.x + b.w - 2 && y1 > b.y + 2 && y0 < b.y + b.h - 2;
      expect(hitsB).toBe(false);
    }
  });

  it('separa en carriles distintos relaciones paralelas y recíprocas a->b y b->a sin solaparse', () => {
    const nodes: NodeBox[] = [
      { id: 'A', x: 80, y: 60, w: 140, h: 70 },
      { id: 'B', x: 80, y: 240, w: 140, h: 70 },
    ];
    const edges: EdgePath[] = [
      { source: 'A', target: 'B', type: 'ASSOCIATION', points: [], routing: 'orthogonal', rel: 0 },
      { source: 'B', target: 'A', type: 'DEPENDENCY', points: [], routing: 'orthogonal', rel: 1 },
    ];

    const routed = routeAllEdges(nodes, [], edges);
    const e0 = routed[0]!;
    const e1 = routed[1]!;
    assertOrthogonalAndTouching(e0, nodes[0]!, nodes[1]!);
    assertOrthogonalAndTouching(e1, nodes[1]!, nodes[0]!);
    expect(JSON.stringify(e0.points)).not.toBe(JSON.stringify(e1.points));
    // Separación mínima entre los puntos de salida en A
    const distStart = Math.hypot((e0.points[0] ?? 0) - (e1.points[e1.points.length - 2] ?? 0), (e0.points[1] ?? 0) - (e1.points[e1.points.length - 1] ?? 0));
    expect(distStart).toBeGreaterThanOrEqual(8);
  });

  it('ciñe el paquete estrictamente sin dejar aire extra y desplaza el paquete rígido si un tercer paquete bloquea el canal', () => {
    const nodes: NodeBox[] = [
      { id: 'A', x: 100, y: 50, w: 100, h: 60, packageName: 'pkg1' },
      { id: 'C', x: 100, y: 170, w: 100, h: 60, packageName: 'pkgMid' },
      { id: 'B', x: 100, y: 290, w: 100, h: 60, packageName: 'pkg2' },
    ];
    // Paquete inflado artificialmente con aire extra
    const inflatedPackages: PackageBox[] = [
      { name: 'pkg1', x: 20, y: 0, w: 300, h: 200 },
      { name: 'pkgMid', x: 84, y: 140, w: 132, h: 106 },
      { name: 'pkg2', x: 84, y: 260, w: 132, h: 106 },
    ];
    const edges: EdgePath[] = [
      { source: 'A', target: 'B', type: 'ASSOCIATION', points: [], routing: 'orthogonal', rel: 0 },
    ];

    const tight = fitPackageBoxes(inflatedPackages, nodes);
    const p1 = tight.find((p) => p.name === 'pkg1')!;
    expect(p1.x).toBe(100 - PKG_PAD.left);
    expect(p1.y).toBe(50 - PKG_PAD.top);
    expect(p1.w).toBe(100 + PKG_PAD.left + PKG_PAD.right);
    expect(p1.h).toBe(60 + PKG_PAD.top + PKG_PAD.bottom);

    const opened = openPackageChannels(nodes, tight, edges);
    const pkgMidAfter = opened.packages.find((p) => p.name === 'pkgMid')!;
    const nodeCAfter = opened.nodes.find((n) => n.id === 'C')!;
    // El paquete intermedio se trasladó rígidamente sin inflar su tamaño
    expect(pkgMidAfter.w).toBe(100 + PKG_PAD.left + PKG_PAD.right);
    expect(pkgMidAfter.x).toBe(nodeCAfter.x - PKG_PAD.left);

    const routed = routeAllEdges(opened.nodes, opened.packages, edges);
    const e = routed[0]!;
    assertOrthogonalAndTouching(e, opened.nodes[0]!, opened.nodes[2]!);

    // La arista inter-paquete pkg1 -> pkg2 no cruza el tercer paquete pkgMid
    const n = e.points.length / 2;
    for (let i = 0; i < n - 1; i++) {
      const x0 = Math.min(e.points[i * 2] ?? 0, e.points[(i + 1) * 2] ?? 0);
      const x1 = Math.max(e.points[i * 2] ?? 0, e.points[(i + 1) * 2] ?? 0);
      const y0 = Math.min(e.points[i * 2 + 1] ?? 0, e.points[(i + 1) * 2 + 1] ?? 0);
      const y1 = Math.max(e.points[i * 2 + 1] ?? 0, e.points[(i + 1) * 2 + 1] ?? 0);
      const crossesPkgMid =
        x1 > pkgMidAfter.x + 1 &&
        x0 < pkgMidAfter.x + pkgMidAfter.w - 1 &&
        y1 > pkgMidAfter.y + 1 &&
        y0 < pkgMidAfter.y + pkgMidAfter.h - 1;
      expect(crossesPkgMid).toBe(false);
    }
  });

  it('rerutea localmente en menos de 16ms con 500 aristas durante un drag (applyOverrides)', () => {
    const nodes: NodeBox[] = [];
    const edges: EdgePath[] = [];
    const cols = 10;
    for (let i = 0; i < 100; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      nodes.push({ id: `N${i}`, x: col * 180, y: row * 120, w: 110, h: 60 });
    }
    for (let i = 0; i < 500; i++) {
      const s = i % 100;
      const t = (s + 1 + Math.floor(i / 100)) % 100;
      const sn = nodes[s]!;
      const tn = nodes[t]!;
      edges.push({
        source: sn.id,
        target: tn.id,
        type: 'ASSOCIATION',
        points: [sn.x + sn.w / 2, sn.y + sn.h, sn.x + sn.w / 2, tn.y, tn.x + tn.w / 2, tn.y],
        routing: 'orthogonal',
        rel: i,
      });
    }

    const baseLayout: LayoutResult = {
      nodes,
      edges,
      packages: [],
      bounds: { x: 0, y: 0, w: 2000, h: 1400 },
    };

    const ov = moveBy(new Map(), 'N0', 45, 30);
    // Calentamiento JIT y medición: mediana de 15 repeticiones para no depender de un pico de GC o de carga
    applyOverrides(baseLayout, ov);
    const samples: number[] = [];
    let updated = applyOverrides(baseLayout, ov);
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      updated = applyOverrides(baseLayout, ov);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const elapsed = samples[Math.floor(samples.length / 2)]!;

    expect(elapsed).toBeLessThan(16);
    const movedN0 = updated.nodes[0]!;
    for (const e of updated.edges) {
      if (e.source === 'N0' || e.target === 'N0') {
        const src = updated.nodes.find((n) => n.id === e.source)!;
        const tgt = updated.nodes.find((n) => n.id === e.target)!;
        assertOrthogonalAndTouching(e, src, tgt);
      }
    }
    expect(movedN0.x).toBe(45);
  });
});
