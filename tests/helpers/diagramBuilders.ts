// tests/helpers/diagramBuilders.ts — fábricas de modelos para los tests de src/render (no se usa en la app).
import type { DiagramModel, RelationshipModel, TypeNode } from '../../src/domain/diagram/model';

export function typeNode(id: string, extra: Partial<TypeNode> = {}): TypeNode {
  return {
    id,
    name: id,
    packageName: '(default package)',
    declaredKind: 'class',
    category: 'class',
    isAbstract: false,
    isSealed: false,
    isExternal: false,
    implicit: false,
    stereotypes: [],
    attributes: [],
    methods: [],
    constructors: [],
    enumConstants: [],
    line: 1,
    ...extra,
  };
}

export function rel(source: string, target: string, extra: Partial<RelationshipModel> = {}): RelationshipModel {
  return { source, target, type: 'ASSOCIATION', line: 1, ...extra };
}

export function diagram(types: TypeNode[], relationships: RelationshipModel[] = [], extra: Partial<DiagramModel> = {}): DiagramModel {
  const byPkg = new Map<string, string[]>();
  for (const t of types) {
    const list = byPkg.get(t.packageName) ?? [];
    list.push(t.id);
    byPkg.set(t.packageName, list);
  }
  const packages = [...byPkg].map(([name, typeIds]) => ({ name, typeIds }));
  return { types, relationships, packages, summaryMode: false, issues: [], ...extra };
}
