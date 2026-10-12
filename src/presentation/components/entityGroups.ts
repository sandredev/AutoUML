// src/presentation/components/entityGroups.ts — grupos de la lista de entidades (puro, T11).
import { classify } from '../../domain/diagram/classify';
import type { Category, DiagramModel } from '../../domain/diagram/model';

export type Grouping = 'package' | 'type';

export const DEFAULT_PACKAGE = '(default package)';

/** Letra del glifo por categoría (la misma en lista, inspector y lienzo). */
export const CATEGORY_LETTER: Record<Category, string> = {
  sealed: 'S',
  abstract: 'A',
  interface: 'I',
  enum: 'E',
  record: 'R',
  annotation: '@',
  class: 'C',
  external: 'X',
  undeclared: '?',
};

/** Orden de los grupos por tipo. */
export const CATEGORY_ORDER: readonly Category[] = ['sealed', 'abstract', 'interface', 'enum', 'record', 'annotation', 'class', 'external', 'undeclared'];

export interface EntityRow {
  id: string;
  name: string;
  packageName: string;
  category: Category;
}

export interface EntityGroup {
  /** Paquete completo o categoría. */
  key: string;
  /** Para paquetes: todo menos el último segmento ("domain.model."), en gris. */
  prefix: string;
  /** Último segmento del paquete; vacío en grupos por tipo (el título lo traduce la vista). */
  leaf: string;
  category: Category | null;
  items: EntityRow[];
}

export interface EntityTree {
  groups: EntityGroup[];
  /** Tipos que no se dibujan, al final y aparte (ordenados por paquete y nombre). */
  outOfView: EntityRow[];
}

function splitPackage(name: string): { prefix: string; leaf: string } {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? { prefix: '', leaf: name } : { prefix: name.slice(0, dot + 1), leaf: name.slice(dot + 1) };
}

const byName = (a: EntityRow, b: EntityRow): number => a.name.localeCompare(b.name) || a.packageName.localeCompare(b.packageName);

/**
 * Lista de entidades: grupos (por paquete o por tipo) con lo que se ve, y aparte lo que está fuera de la vista.
 * `query` filtra por nombre o paquete (sin distinguir mayúsculas); los grupos que quedan vacíos no salen.
 */
export function entityTree(model: DiagramModel, grouping: Grouping, outOfView: ReadonlySet<string>, query = ''): EntityTree {
  const needle = query.trim().toLowerCase();
  const rows: EntityRow[] = model.types
    .map((t) => ({ id: t.id, name: t.name, packageName: t.packageName, category: classify(t) }))
    .filter((r) => needle === '' || r.name.toLowerCase().includes(needle) || r.packageName.toLowerCase().includes(needle));
  const inView = rows.filter((r) => !outOfView.has(r.id));
  const out = rows
    .filter((r) => outOfView.has(r.id))
    .sort((a, b) => a.packageName.localeCompare(b.packageName) || a.name.localeCompare(b.name));

  const buckets = new Map<string, EntityRow[]>();
  for (const r of inView) {
    const key = grouping === 'package' ? r.packageName : r.category;
    const list = buckets.get(key);
    if (list) list.push(r);
    else buckets.set(key, [r]);
  }
  let keys = [...buckets.keys()];
  if (grouping === 'package') {
    // El paquete por defecto, al final.
    keys = keys.sort((a, b) => Number(a === DEFAULT_PACKAGE) - Number(b === DEFAULT_PACKAGE) || a.localeCompare(b));
  } else {
    keys = CATEGORY_ORDER.filter((c) => buckets.has(c));
  }
  const groups = keys.map((key): EntityGroup => {
    const items = (buckets.get(key) ?? []).sort(byName);
    if (grouping === 'package') {
      const { prefix, leaf } = key === DEFAULT_PACKAGE ? { prefix: '', leaf: '' } : splitPackage(key);
      return { key, prefix, leaf, category: null, items };
    }
    return { key, prefix: '', leaf: '', category: key as Category, items };
  });
  return { groups, outOfView: out };
}
