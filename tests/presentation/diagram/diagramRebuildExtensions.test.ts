// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { runHierarchicalElkLayout } from '../../../src/presentation/diagram/layout/elkLayout';
import { fitPackagesBottomUp, PACKAGE_HEADER_HEIGHT, PACKAGE_PADDING } from '../../../src/presentation/diagram/routing/packageFit';
import { nudgeRoutedEdges, enforceOrthogonal } from '../../../src/presentation/diagram/routing/nudge';
import {
  hitTestDiagramEdges,
  moveOrthogonalSegment,
  splitEdgeSegmentAt,
  deleteEdgeWaypoint,
  simplifyOrthogonalPolyline,
  clampEndpointToNode,
  getEdgesIntersectedByKnife,
} from '../../../src/presentation/diagram/canvas/edgeHit';
import {
  findTargetPackageUnderPointer,
  movePackageSubtreeInModel,
  moveSingleNodeInModel,
  nestPackageInModel,
} from '../../../src/presentation/diagram/canvas/overrides';
import {
  syncNestedPackageInPuml,
  syncReconnectedRelationInPuml,
  syncBrokenRelationsInPuml,
} from '../../../src/application/puml/sourceSync';
import { renderDiagramCanvasFrame } from '../../../src/presentation/diagram/canvas/draw';
import type { DiagramLayoutModel } from '../../../src/presentation/diagram/types';
import { recordingCanvas } from '../../helpers/recordingCanvas';

describe('Diagram Rebuild (T12) Extensions', () => {
  describe('elkLayout & packageFit', () => {
    it('runHierarchicalElkLayout genera estructura de paquetes y nodos', async () => {
      const model = await runHierarchicalElkLayout(
        [
          { id: 'A', name: 'ClassA', packagePath: 'net.core', width: 120, height: 60 },
          { id: 'B', name: 'ClassB', packagePath: 'net.core', width: 120, height: 60 },
          { id: 'C', name: 'ClassC', width: 120, height: 60 },
        ],
        [{ id: 'e1', source: 'A', target: 'B', kind: 'association' }]
      );

      expect(model.nodes.has('A')).toBe(true);
      expect(model.nodes.has('B')).toBe(true);
      expect(model.nodes.has('C')).toBe(true);
      expect(model.packages.length).toBeGreaterThanOrEqual(1);
      expect(model.edges).toHaveLength(1);
    });

    it('fitPackagesBottomUp ajusta dimensiones según hijos', () => {
      const model: DiagramLayoutModel = {
        nodes: new Map([
          ['n1', { id: 'n1', name: 'N1', packagePath: 'pkg1', x: 100, y: 100, width: 80, height: 50 }],
        ]),
        packages: [
          { id: 'pkg:pkg1', name: 'pkg1', fullPath: 'pkg1', depth: 0, x: 0, y: 0, width: 10, height: 10 },
        ],
        edges: [],
        width: 1000,
        height: 1000,
      };

      fitPackagesBottomUp(model);
      const pkg = model.packages[0];
      expect(pkg.x).toBe(100 - PACKAGE_PADDING);
      expect(pkg.y).toBe(100 - PACKAGE_HEADER_HEIGHT);
      expect(pkg.width).toBe(80 + PACKAGE_PADDING * 2);
      expect(pkg.height).toBe(50 + PACKAGE_HEADER_HEIGHT + PACKAGE_PADDING);
    });
  });

  describe('nudge & orthogonal routing', () => {
    it('enforceOrthogonal convierte líneas oblicuas en ortogonales', () => {
      const ortho = enforceOrthogonal([{ x: 0, y: 0 }, { x: 100, y: 100 }]);
      expect(ortho.length).toBeGreaterThan(2);
      // Todos los tramos adyacentes son puramente horizontales o verticales
      for (let i = 0; i < ortho.length - 1; i++) {
        const dx = Math.abs(ortho[i + 1].x - ortho[i].x);
        const dy = Math.abs(ortho[i + 1].y - ortho[i].y);
        expect(dx === 0 || dy === 0 || dx < 1e-6 || dy < 1e-6).toBe(true);
      }
    });

    it('nudgeRoutedEdges separa carriles paralelos', () => {
      const nodes = new Map([
        ['A', { id: 'A', name: 'A', x: 0, y: 0, width: 100, height: 60 }],
        ['B', { id: 'B', name: 'B', x: 0, y: 300, width: 100, height: 60 }],
      ]);
      const edges = [
        {
          id: 'e1',
          source: 'A',
          target: 'B',
          kind: 'association' as const,
          points: [{ x: 50, y: 60 }, { x: 50, y: 150 }, { x: 200, y: 150 }, { x: 200, y: 300 }, { x: 50, y: 300 }],
        },
        {
          id: 'e2',
          source: 'A',
          target: 'B',
          kind: 'association' as const,
          points: [{ x: 50, y: 60 }, { x: 50, y: 150 }, { x: 200, y: 150 }, { x: 200, y: 300 }, { x: 50, y: 300 }],
        },
      ];

      const nudged = nudgeRoutedEdges(edges, nodes);
      expect(nudged).toHaveLength(2);
      // El segmento interior horizontal se separa
      expect(nudged[0].points[2].y).not.toBe(nudged[1].points[2].y);
    });
  });

  describe('edgeHit & manipulation', () => {
    it('hitTestDiagramEdges detecta handles, waypoints y segmentos', () => {
      const edges = [
        {
          id: 'e1',
          source: 'A',
          target: 'B',
          kind: 'association' as const,
          points: [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 100 }],
        },
      ];

      const handleHit = hitTestDiagramEdges(10, 10, edges, 1);
      expect(handleHit?.kind).toBe('source-handle');

      const waypointHit = hitTestDiagramEdges(100, 10, edges, 1);
      expect(waypointHit?.kind).toBe('waypoint');

      const segmentHit = hitTestDiagramEdges(50, 10, edges, 1);
      expect(segmentHit?.kind).toBe('segment');
    });

    it('splitEdgeSegmentAt inserta escalón ortogonal', () => {
      const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
      const res = splitEdgeSegmentAt(points, 0, 50, 20);
      expect(res.points.length).toBe(4);
    });

    it('deleteEdgeWaypoint elimina codo y recompone', () => {
      const points = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 50 }];
      const res = deleteEdgeWaypoint(points, 1);
      expect(res.length).toBeLessThan(points.length);
    });

    it('moveOrthogonalSegment desliza tramo ortogonal', () => {
      const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
      const res = moveOrthogonalSegment(points, 0, 50, 20);
      expect(res.points[res.activeSegmentIndex].y).toBe(20);
    });

    it('simplifyOrthogonalPolyline colapsa puntos redundantes', () => {
      const points = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }];
      const simplified = simplifyOrthogonalPolyline(points);
      expect(simplified.length).toBe(2);
    });

    it('clampEndpointToNode sujeta extremos al borde', () => {
      const node = { id: 'A', name: 'A', x: 100, y: 100, width: 80, height: 60 };
      const pt = clampEndpointToNode(node, { x: 50, y: 130 });
      expect(pt.x).toBe(100);
    });

    it('getEdgesIntersectedByKnife detecta aristas cortadas', () => {
      const edges = [
        {
          id: 'e1',
          source: 'A',
          target: 'B',
          kind: 'association' as const,
          points: [{ x: 0, y: 50 }, { x: 100, y: 50 }],
        },
      ];
      const cuts = getEdgesIntersectedByKnife({ x: 50, y: 0 }, { x: 50, y: 100 }, edges);
      expect(cuts).toEqual(['e1']);
    });
  });

  describe('overrides & package nesting', () => {
    it('findTargetPackageUnderPointer excluye el propio paquete arrastrado', () => {
      const pkgs = [
        { id: 'p1', name: 'p1', fullPath: 'p1', depth: 0, x: 0, y: 0, width: 200, height: 200 },
        { id: 'p2', name: 'p2', fullPath: 'p2', depth: 0, x: 300, y: 0, width: 200, height: 200 },
      ];

      const target = findTargetPackageUnderPointer(50, 50, pkgs, 'p1');
      expect(target).toBeNull();

      const target2 = findTargetPackageUnderPointer(350, 50, pkgs, 'p1');
      expect(target2?.fullPath).toBe('p2');
    });

    it('nestPackageInModel actualiza rutas jerárquicas y profundidad', () => {
      const model: DiagramLayoutModel = {
        nodes: new Map([
          ['A', { id: 'A', name: 'A', packagePath: 'sub', x: 10, y: 10, width: 50, height: 50 }],
        ]),
        packages: [
          { id: 'pkg:root', name: 'root', fullPath: 'root', depth: 0, x: 0, y: 0, width: 300, height: 300 },
          { id: 'pkg:sub', name: 'sub', fullPath: 'sub', depth: 0, x: 10, y: 10, width: 100, height: 100 },
        ],
        edges: [],
        width: 500,
        height: 500,
      };

      const result = nestPackageInModel(model, 'sub', 'root');
      expect(result).toEqual({ oldPath: 'sub', newPath: 'root.sub' });
      expect(model.nodes.get('A')?.packagePath).toBe('root.sub');
      const sub = model.packages.find((p) => p.name === 'sub');
      expect(sub?.fullPath).toBe('root.sub');
      expect(sub?.parentPath).toBe('root');
      expect(sub?.depth).toBe(1);
    });

    it('movePackageSubtreeInModel traslada paquete e hijos', () => {
      const model: DiagramLayoutModel = {
        nodes: new Map([
          ['A', { id: 'A', name: 'A', packagePath: 'sub', x: 10, y: 10, width: 50, height: 50 }],
        ]),
        packages: [
          { id: 'pkg:sub', name: 'sub', fullPath: 'sub', depth: 0, x: 10, y: 10, width: 100, height: 100 },
        ],
        edges: [],
        width: 500,
        height: 500,
      };

      movePackageSubtreeInModel(model, 'sub', 20, 30);
      expect(model.packages[0].x).toBe(30);
      expect(model.nodes.get('A')?.x).toBe(30);
    });

    it('moveSingleNodeInModel traslada nodo', () => {
      const model: DiagramLayoutModel = {
        nodes: new Map([
          ['A', { id: 'A', name: 'A', x: 10, y: 10, width: 50, height: 50 }],
        ]),
        packages: [],
        edges: [],
        width: 500,
        height: 500,
      };

      moveSingleNodeInModel(model, 'A', 15, 25);
      expect(model.nodes.get('A')?.x).toBe(25);
      expect(model.nodes.get('A')?.y).toBe(35);
    });
  });

  describe('sourceSync PlantUML bidireccional', () => {
    it('syncNestedPackageInPuml renombra declaraciones package/namespace', () => {
      const puml = '@startuml\npackage "domain.sub" {\n  class User\n}\n@enduml';
      const updated = syncNestedPackageInPuml(puml, 'domain.sub', 'core.domain.sub');
      expect(updated).toContain('package "core.domain.sub" {');
    });

    it('syncReconnectedRelationInPuml actualiza origen o destino', () => {
      const puml = '@startuml\nUser --> Order : places\n@enduml';
      const updated = syncReconnectedRelationInPuml(puml, 'User', 'Order', 'Customer', 'Order');
      expect(updated).toContain('Customer --> Order : places');
    });

    it('syncBrokenRelationsInPuml elimina relaciones cortadas', () => {
      const puml = '@startuml\nclass A\nclass B\nA --> B\n@enduml';
      const updated = syncBrokenRelationsInPuml(puml, [{ source: 'A', target: 'B' }]);
      expect(updated).not.toContain('A --> B');
      expect(updated).toContain('class A');
      expect(updated).toContain('class B');
    });
  });

  describe('draw batching frame', () => {
    it('renderDiagramCanvasFrame corre sin excepciones', () => {
      const { ctx } = recordingCanvas();

      const model: DiagramLayoutModel = {
        nodes: new Map([
          ['A', { id: 'A', name: 'User', x: 20, y: 20, width: 100, height: 50 }],
        ]),
        packages: [
          { id: 'pkg:app', name: 'app', fullPath: 'app', depth: 0, x: 10, y: 10, width: 200, height: 150 },
        ],
        edges: [
          { id: 'e1', source: 'A', target: 'A', kind: 'association', points: [{ x: 20, y: 20 }, { x: 50, y: 50 }] },
        ],
        width: 800,
        height: 600,
      };

      expect(() => {
        renderDiagramCanvasFrame(
          ctx,
          model,
          { x: 0, y: 0, zoom: 1, width: 800, height: 600 },
          { selectedEdgeId: 'e1', dropTargetPkgPath: 'app', knifeLine: { start: { x: 0, y: 0 }, end: { x: 100, y: 100 } } }
        );
      }).not.toThrow();
    });
  });
});
