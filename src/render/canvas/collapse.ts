import type { DiagramModel } from '../../core/model';
import type { EdgePath, LayoutResult, NodeBox } from '../types';

export const PACKAGE_NODE_PREFIX = '\u0000package:';
const COLLAPSED_NODE_HEIGHT = 48;
const COLLAPSED_NODE_WIDTH = 190;

function center(box: NodeBox): [number, number] {
  return [box.x + box.w / 2, box.y + box.h / 2];
}

function borderPoint(box: NodeBox, towardX: number, towardY: number): [number, number] {
  const [cx, cy] = center(box);
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const sx = dx === 0 ? Infinity : box.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : box.h / 2 / Math.abs(dy);
  const scale = Math.min(sx, sy);
  return [cx + dx * scale, cy + dy * scale];
}

/** Replaces each collapsed package's members with one summary node. */
export function collapsePackages(
  model: DiagramModel,
  layout: LayoutResult,
  collapsed: ReadonlySet<string>,
): LayoutResult {
  if (collapsed.size === 0) return layout;

  const packageByType = new Map(model.types.map((type) => [type.id, type.packageName]));
  const packageBoxes = new Map(layout.packages.map((box) => [box.name, box]));
  const packageCounts = new Map<string, number>();
  for (const type of model.types) {
    if (collapsed.has(type.packageName)) packageCounts.set(type.packageName, (packageCounts.get(type.packageName) ?? 0) + 1);
  }

  const aggregateBoxes = new Map<string, NodeBox>();
  for (const name of collapsed) {
    const box = packageBoxes.get(name);
    if (!box) continue;
    aggregateBoxes.set(name, {
      id: `${PACKAGE_NODE_PREFIX}${name}`,
      x: box.x,
      y: box.y,
      w: Math.max(COLLAPSED_NODE_WIDTH, Math.min(box.w, 280)),
      h: COLLAPSED_NODE_HEIGHT,
      label: name,
      subtitle: `${packageCounts.get(name) ?? 0} entidades · clic para expandir`,
      packageName: name,
    });
  }

  const nodeForType = new Map<string, string>();
  for (const node of layout.nodes) {
    const pkg = packageByType.get(node.id);
    nodeForType.set(node.id, pkg && aggregateBoxes.has(pkg) ? `${PACKAGE_NODE_PREFIX}${pkg}` : node.id);
  }
  const displayedNodes = layout.nodes.filter((node) => nodeForType.get(node.id) === node.id);
  displayedNodes.push(...aggregateBoxes.values());
  const nodeById = new Map(displayedNodes.map((node) => [node.id, node]));

  const edges: EdgePath[] = [];
  for (const edge of layout.edges) {
    const sourceId = nodeForType.get(edge.source) ?? edge.source;
    const targetId = nodeForType.get(edge.target) ?? edge.target;
    if (sourceId === targetId) continue;
    const source = nodeById.get(sourceId);
    const target = nodeById.get(targetId);
    if (!source || !target) continue;

    const [scx, scy] = center(source);
    const [tcx, tcy] = center(target);
    const original = edge.points;
    const towardSource = sourceId === edge.source
      ? [original[2] ?? tcx, original[3] ?? tcy] as [number, number]
      : [tcx, tcy];
    const towardTarget = targetId === edge.target
      ? [original[original.length - 4] ?? scx, original[original.length - 3] ?? scy] as [number, number]
      : [scx, scy];
    const [sx, sy] = borderPoint(source, towardSource[0], towardSource[1]);
    const [tx, ty] = borderPoint(target, towardTarget[0], towardTarget[1]);
    const middle = original.slice(2, -2);
    edges.push({ ...edge, source: sourceId, target: targetId, points: [sx, sy, ...middle, tx, ty] });
  }

  const packages = layout.packages.filter((box) => !aggregateBoxes.has(box.name));
  const points: number[] = [];
  for (const node of displayedNodes) points.push(node.x, node.y, node.x + node.w, node.y + node.h);
  for (const pkg of packages) points.push(pkg.x, pkg.y, pkg.x + pkg.w, pkg.y + pkg.h);
  for (const edge of edges) points.push(...edge.points);
  if (points.length === 0) return { nodes: displayedNodes, edges, packages, bounds: layout.bounds };

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 3 < points.length; i += 4) {
    x0 = Math.min(x0, points[i] ?? 0);
    y0 = Math.min(y0, points[i + 1] ?? 0);
    x1 = Math.max(x1, points[i + 2] ?? 0);
    y1 = Math.max(y1, points[i + 3] ?? 0);
  }
  return { nodes: displayedNodes, edges, packages, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

/** Package name under the pointer when the click lands in its title strip. */
export function hitTestPackageHeader(layout: LayoutResult, x: number, y: number): string | null {
  for (let i = layout.packages.length - 1; i >= 0; i--) {
    const pkg = layout.packages[i];
    if (pkg && x >= pkg.x && x <= pkg.x + pkg.w && y >= pkg.y && y <= pkg.y + 24) return pkg.name;
  }
  return null;
}
