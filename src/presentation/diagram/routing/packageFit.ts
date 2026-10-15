// src/presentation/diagram/routing/packageFit.ts — ajuste estricto de paquetes y apertura rígida de canales (puro, sin DOM/React).
import type { DiagramModel } from '../../../domain/diagram/model';
import type { EdgePath, NodeBox, NoteBox, PackageBox, DiagramLayoutModel } from '../types';
import { CHANNEL_STEP, EDGE_GAP, EPS, PKG_PAD } from './constants';

const DEFAULT_PACKAGE = '(default package)';

/**
 * Calcula las cajas de paquete ciñéndose estrictamente a sus tarjetas (`envelope(nodes) + PKG_PAD`).
 * Jamás incluye puntos de aristas ni conserva aire residual.
 */
export function fitPackageBoxes(
  packages: readonly PackageBox[],
  nodes: readonly NodeBox[],
): PackageBox[] {
  const byPkg = new Map<string, NodeBox[]>();
  for (const n of nodes) {
    if (n.packageName === undefined) continue;
    const list = byPkg.get(n.packageName);
    if (list) list.push(n);
    else byPkg.set(n.packageName, [n]);
  }

  return packages.map((p) => {
    const members = byPkg.get(p.name);
    if (!members || members.length === 0) return { ...p };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const m of members) {
      x0 = Math.min(x0, m.x - PKG_PAD.left);
      y0 = Math.min(y0, m.y - PKG_PAD.top);
      x1 = Math.max(x1, m.x + m.w + PKG_PAD.right);
      y1 = Math.max(y1, m.y + m.h + PKG_PAD.bottom);
    }
    if (!Number.isFinite(x0) || x1 <= x0 || y1 <= y0) return { ...p };
    return { ...p, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  });
}

/** Construye las cajas de paquete desde el DiagramModel aplicando `envelope(nodes) + PKG_PAD` estricto. */
export function packageBoxesFromModel(
  model: DiagramModel,
  nodes: readonly NodeBox[],
  layerOf: ReadonlyMap<string, string | undefined>,
): PackageBox[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const out: PackageBox[] = [];
  for (const p of model.packages) {
    if (p.name === DEFAULT_PACKAGE) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const id of p.typeIds) {
      const b = byId.get(id);
      if (!b || (b.packageName !== undefined && b.packageName !== p.name)) continue;
      x0 = Math.min(x0, b.x - PKG_PAD.left);
      y0 = Math.min(y0, b.y - PKG_PAD.top);
      x1 = Math.max(x1, b.x + b.w + PKG_PAD.right);
      y1 = Math.max(y1, b.y + b.h + PKG_PAD.bottom);
    }
    if (!Number.isFinite(x0)) continue;
    const box: PackageBox = {
      name: p.name,
      x: x0,
      y: y0,
      w: x1 - x0,
      h: y1 - y0,
    };
    const layer = layerOf.get(p.name) ?? p.layer;
    if (layer !== undefined) box.layer = layer;
    out.push(box);
  }
  return out;
}

export interface ChannelPushResult {
  readonly nodes: NodeBox[];
  readonly packages: PackageBox[];
  readonly notes?: NoteBox[];
  readonly pushedNodeIds: ReadonlySet<string>;
}

/**
 * Si dos paquetes se solapan, o si entre dos paquetes conectados no cabe el canal ortogonal necesario,
 * o si un tercer paquete bloquea el canal recto entre dos paquetes, desplaza el paquete rígido entero
 * (sus tarjetas y su caja envolvente) sin agrandarlo.
 */
export function openPackageChannels(
  nodes: readonly NodeBox[],
  packages: readonly PackageBox[],
  edges: readonly Pick<EdgePath, 'source' | 'target'>[],
  notes?: readonly NoteBox[],
): ChannelPushResult {
  if (packages.length === 0) {
    const res: ChannelPushResult = {
      nodes: nodes.map((n) => ({ ...n })),
      packages: [],
      pushedNodeIds: new Set(),
    };
    return notes ? { ...res, notes: notes.map((n) => ({ ...n })) } : res;
  }

  const nextNodes = nodes.map((n) => ({ ...n }));
  let nextPackages = fitPackageBoxes(packages, nextNodes);
  const nextNotes = notes ? notes.map((n) => ({ ...n })) : undefined;
  const pushedNodeIds = new Set<string>();

  const nodeById = new Map(nextNodes.map((n) => [n.id, n] as const));

  // Contar cuántas aristas inter-paquete conectan cada par de paquetes
  const pairEdgeCount = new Map<string, number>();
  for (const e of edges) {
    const ns = nodeById.get(e.source);
    const nt = nodeById.get(e.target);
    if (!ns || !nt || !ns.packageName || !nt.packageName || ns.packageName === nt.packageName) continue;
    const a = ns.packageName < nt.packageName ? ns.packageName : nt.packageName;
    const b = ns.packageName < nt.packageName ? nt.packageName : ns.packageName;
    const key = `${a}::${b}`;
    pairEdgeCount.set(key, (pairEdgeCount.get(key) ?? 0) + 1);
  }

  const shiftPackageRigid = (pkgName: string, dx: number, dy: number): void => {
    if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return;
    const memberIds = new Set<string>();
    for (const n of nextNodes) {
      if (n.packageName === pkgName) {
        n.x += dx;
        n.y += dy;
        memberIds.add(n.id);
        pushedNodeIds.add(n.id);
      }
    }
    if (nextNotes) {
      for (const note of nextNotes) {
        if (note.anchor !== undefined && memberIds.has(note.anchor)) {
          note.x += dx;
          note.y += dy;
        }
      }
    }
    nextPackages = fitPackageBoxes(nextPackages, nextNodes);
  };

  // 1. Garantizar que ningún par de paquetes se solape y que tengan el canal requerido para sus aristas
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let i = 0; i < nextPackages.length; i++) {
      for (let j = i + 1; j < nextPackages.length; j++) {
        const pa = nextPackages[i];
        const pb = nextPackages[j];
        if (!pa || !pb) continue;
        const k1 = pa.name < pb.name ? `${pa.name}::${pb.name}` : `${pb.name}::${pa.name}`;
        const interEdges = pairEdgeCount.get(k1) ?? 0;
        const requiredGap = Math.max(EDGE_GAP * 2, interEdges > 0 ? (interEdges + 1) * CHANNEL_STEP : EDGE_GAP * 2);

        const overlapX = Math.min(pa.x + pa.w, pb.x + pb.w) - Math.max(pa.x, pb.x);
        const overlapY = Math.min(pa.y + pa.h, pb.y + pb.h) - Math.max(pa.y, pb.y);

        // Si se solapan en un eje y en el otro están a menos de requiredGap, abrir canal
        if (overlapX > -EDGE_GAP && overlapY > -requiredGap) {
          const gapX = -overlapX;
          const gapY = -overlapY;
          const needX = requiredGap - gapX;
          const needY = requiredGap - gapY;
          if (needX > EPS && needY > EPS) {
            const acx = pa.x + pa.w / 2;
            const bcx = pb.x + pb.w / 2;
            const acy = pa.y + pa.h / 2;
            const bcy = pb.y + pb.h / 2;
            if (needX <= needY) {
              const dir = bcx >= acx ? 1 : -1;
              shiftPackageRigid(pb.name, dir * needX, 0);
            } else {
              const dir = bcy >= acy ? 1 : -1;
              shiftPackageRigid(pb.name, 0, dir * needY);
            }
            changed = true;
          }
        }
      }
    }

    // 2. Si un tercer paquete C bloquea el canal entre dos paquetes conectados A y B sin dejar pasillo
    for (const [key, count] of pairEdgeCount) {
      if (count === 0) continue;
      const [nameA, nameB] = key.split('::');
      const pa = nextPackages.find((p) => p.name === nameA);
      const pb = nextPackages.find((p) => p.name === nameB);
      if (!pa || !pb) continue;

      const corrX0 = Math.min(pa.x, pb.x);
      const corrX1 = Math.max(pa.x + pa.w, pb.x + pb.w);
      const corrY0 = Math.min(pa.y, pb.y);
      const corrY1 = Math.max(pa.y + pa.h, pb.y + pb.h);
      const channelWidth = Math.max(EDGE_GAP * 3, (count + 1) * CHANNEL_STEP);

      for (const pc of nextPackages) {
        if (pc.name === pa.name || pc.name === pb.name) continue;
        const inCorrX = pc.x < corrX1 - EPS && pc.x + pc.w > corrX0 + EPS;
        const inCorrY = pc.y < corrY1 - EPS && pc.y + pc.h > corrY0 + EPS;
        if (!inCorrX || !inCorrY) continue;

        // Comprobar si C está estrictamente entre A y B en X o en Y y ahoga el canal
        const betweenY =
          (pa.y + pa.h <= pc.y + EPS && pc.y + pc.h <= pb.y + EPS) ||
          (pb.y + pb.h <= pc.y + EPS && pc.y + pc.h <= pa.y + EPS);
        const betweenX =
          (pa.x + pa.w <= pc.x + EPS && pc.x + pc.w <= pb.x + EPS) ||
          (pb.x + pb.w <= pc.x + EPS && pc.x + pc.w <= pa.x + EPS);

        if (betweenY) {
          const midX = (pa.x + pa.w / 2 + pb.x + pb.w / 2) / 2;
          if (midX > pc.x - channelWidth / 2 && midX < pc.x + pc.w + channelWidth / 2) {
            const pushLeft = pc.x + pc.w - (midX - channelWidth / 2);
            const pushRight = midX + channelWidth / 2 - pc.x;
            const dx = pushLeft <= pushRight ? -pushLeft : pushRight;
            shiftPackageRigid(pc.name, dx, 0);
            changed = true;
          }
        } else if (betweenX) {
          const midY = (pa.y + pa.h / 2 + pb.y + pb.h / 2) / 2;
          if (midY > pc.y - channelWidth / 2 && midY < pc.y + pc.h + channelWidth / 2) {
            const pushUp = pc.y + pc.h - (midY - channelWidth / 2);
            const pushDown = midY + channelWidth / 2 - pc.y;
            const dy = pushUp <= pushDown ? -pushUp : pushDown;
            shiftPackageRigid(pc.name, 0, dy);
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }

  const out: ChannelPushResult = {
    nodes: nextNodes,
    packages: nextPackages,
    pushedNodeIds,
  };
  return nextNotes ? { ...out, notes: nextNotes } : out;
}

export const PACKAGE_HEADER_HEIGHT = 40;
export const PACKAGE_PADDING = 24;

/**
 * Recalcula los contenedores de paquetes de abajo hacia arriba (Bottom-Up)
 * para garantizar que ningún paquete hijo o nodo se salga de su paquete padre.
 */
export function fitPackagesBottomUp(model: DiagramLayoutModel): void {
  const byDepthDesc = [...model.packages].sort((a, b) => b.depth - a.depth);

  for (const pkg of byDepthDesc) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let hasChildren = false;

    for (const node of model.nodes.values()) {
      if (node.packagePath === pkg.fullPath) {
        hasChildren = true;
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + node.width);
        maxY = Math.max(maxY, node.y + node.height);
      }
    }

    for (const subPkg of model.packages) {
      if (subPkg.parentPath === pkg.fullPath) {
        hasChildren = true;
        minX = Math.min(minX, subPkg.x);
        minY = Math.min(minY, subPkg.y);
        maxX = Math.max(maxX, subPkg.x + subPkg.width);
        maxY = Math.max(maxY, subPkg.y + subPkg.height);
      }
    }

    if (hasChildren) {
      pkg.x = minX - PACKAGE_PADDING;
      pkg.y = minY - PACKAGE_HEADER_HEIGHT;
      pkg.width = maxX - minX + PACKAGE_PADDING * 2;
      pkg.height = maxY - minY + PACKAGE_HEADER_HEIGHT + PACKAGE_PADDING;
    }
  }
}
