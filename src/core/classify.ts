// src/core/classify.ts
import type { Category, CategoryCounts, DiagramModel, SidebarGroup, TypeNode } from './model';

/** Clasifica un tipo en exactamente una categoría (el primero que coincide gana). */
export function classify(type: TypeNode): Category {
  if (type.isExternal) return 'external';
  if (type.implicit) return 'undeclared';
  if (type.isSealed) return 'sealed';
  switch (type.declaredKind) {
    case 'enum':
      return 'enum';
    case 'record':
      return 'record';
    case 'annotation':
      return 'annotation';
    case 'interface':
      return 'interface';
    case 'abstract':
      return 'abstract';
    default:
      return 'class';
  }
}

/** Cuenta los tipos por categoría. totalInternal = suma de las 7 categorías internas. */
export function countByCategory(model: DiagramModel): CategoryCounts {
  const c: CategoryCounts = {
    sealed: 0,
    abstract: 0,
    interface: 0,
    enum: 0,
    record: 0,
    annotation: 0,
    class: 0,
    totalInternal: 0,
    external: 0,
    undeclared: 0,
  };
  for (const t of model.types) {
    c[classify(t)]++;
  }
  c.totalInternal = c.sealed + c.abstract + c.interface + c.enum + c.record + c.annotation + c.class;
  return c;
}

/** Orden y etiquetas de los grupos de la sidebar. */
const GROUPS: ReadonlyArray<{ category: Category; label: string }> = [
  { category: 'sealed', label: 'Sealed' },
  { category: 'abstract', label: 'Abstracts' },
  { category: 'interface', label: 'Interfaces' },
  { category: 'enum', label: 'Enums' },
  { category: 'record', label: 'Records' },
  { category: 'annotation', label: 'Annotations' },
  { category: 'class', label: 'Clases' },
  { category: 'external', label: 'Externas' },
  { category: 'undeclared', label: 'Sin declarar' },
];

/** Construye el árbol de la sidebar; incluye siempre los 9 grupos (aunque estén vacíos). */
export function buildTree(model: DiagramModel): SidebarGroup[] {
  const buckets = new Map<Category, SidebarGroup['items']>();
  for (const g of GROUPS) buckets.set(g.category, []);
  for (const t of model.types) {
    buckets.get(classify(t))?.push({ id: t.id, name: t.name, packageName: t.packageName });
  }
  return GROUPS.map((g) => {
    const items = buckets.get(g.category) ?? [];
    items.sort((a, b) => a.name.localeCompare(b.name) || a.packageName.localeCompare(b.packageName));
    return { category: g.category, label: g.label, count: items.length, items };
  });
}
