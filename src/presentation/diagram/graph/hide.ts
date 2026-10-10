// src/presentation/diagram/graph/hide.ts — hide/show/remove de DiagramModel.hide (puro).
import type { DiagramModel, TypeNode, Visibility } from '../../../domain/diagram/model';
import { DEFAULT_DISPLAY, type CardDisplay } from '../style/contract';

export interface HideRules {
  emptyFields: boolean;
  emptyMethods: boolean;
  fields: boolean;
  methods: boolean;
  circle: boolean;
  stereotype: boolean;
  privateMembers: boolean;
  unlinked: boolean;
  /** Estereotipos ocultos ("hide <<X>>"), sin los << >>. */
  stereotypes: Set<string>;
  /** Tipos ocultos ("hide Clase"), por id o por nombre. */
  types: Set<string>;
}

const RE_RULE = /^(hide|show|remove|restore)\s+(.+?)\s*$/iu;
const RE_STEREO = /^<<\s*(.+?)\s*>>$/u;

/** Interpreta las líneas en orden: un "show" posterior deshace un "hide" anterior. */
export function parseHide(lines: readonly string[]): HideRules {
  const r: HideRules = {
    emptyFields: false,
    emptyMethods: false,
    fields: false,
    methods: false,
    circle: false,
    stereotype: false,
    privateMembers: false,
    unlinked: false,
    stereotypes: new Set(),
    types: new Set(),
  };
  for (const raw of lines) {
    const m = RE_RULE.exec(raw.trim());
    if (!m?.[1] || !m[2]) continue;
    const verb = m[1].toLowerCase();
    const on = verb === 'hide' || verb === 'remove';
    const what = m[2].trim();
    const low = what.toLowerCase();
    if (low === 'empty members') {
      r.emptyFields = on;
      r.emptyMethods = on;
    } else if (low === 'empty fields' || low === 'empty attributes') r.emptyFields = on;
    else if (low === 'empty methods') r.emptyMethods = on;
    else if (low === 'fields' || low === 'attributes') r.fields = on;
    else if (low === 'methods') r.methods = on;
    else if (low === 'circle') r.circle = on;
    else if (low === 'stereotype' || low === 'stereotypes') r.stereotype = on;
    else if (low === 'private members') r.privateMembers = on;
    else if (low === '@unlinked') r.unlinked = on;
    else if (low === 'members') continue; // lo gestiona summaryMode (parser)
    else {
      const st = RE_STEREO.exec(what);
      const set = st?.[1] ? r.stereotypes : r.types;
      const key = st?.[1] ?? what;
      if (on) set.add(key);
      else set.delete(key);
    }
  }
  return r;
}

const isPrivate = (m: { visibility: Visibility }): boolean => m.visibility === '-';

/** Copia del tipo sin sus miembros privados (atributos, métodos y constructores). */
function withoutPrivate(t: TypeNode): TypeNode {
  const attributes = t.attributes.filter((a) => !isPrivate(a));
  const methods = t.methods.filter((m) => !isPrivate(m));
  const constructors = t.constructors.filter((c) => !isPrivate(c));
  const same = attributes.length === t.attributes.length && methods.length === t.methods.length
    && constructors.length === t.constructors.length;
  return same ? t : { ...t, attributes, methods, constructors };
}

/** Cómo se dibujan las tarjetas con estas reglas (más skinparam classAttributeIconSize). */
export function displayOf(rules: HideRules, visibilityIcons = true): CardDisplay {
  return {
    ...DEFAULT_DISPLAY,
    showCircle: !rules.circle,
    showStereotype: !rules.stereotype,
    hideEmptyFields: rules.emptyFields,
    hideEmptyMethods: rules.emptyMethods,
    hideFields: rules.fields,
    hideMethods: rules.methods,
    visibilityIcons,
  };
}

/**
 * Aplica las reglas al modelo sin mutarlo: quita los tipos ocultos (con sus relaciones y notas
 * ancladas) y los miembros privados. Si nada cambia devuelve el MISMO modelo.
 */
export function applyHide(
  model: DiagramModel,
  rules: HideRules,
  visibilityIcons = true,
): { model: DiagramModel; display: CardDisplay } {
  const display = displayOf(rules, visibilityIcons);
  const noop = rules.types.size === 0 && rules.stereotypes.size === 0 && !rules.unlinked && !rules.privateMembers;
  if (noop) return { model, display };

  const linked = new Set<string>();
  for (const r of model.relationships) {
    if (r.source === r.target) continue; // un bucle no "enlaza" la clase con el resto
    linked.add(r.source);
    linked.add(r.target);
  }

  const types: TypeNode[] = [];
  for (const t of model.types) {
    if (rules.types.has(t.id) || rules.types.has(t.name)) continue;
    if (t.stereotypes.some((s) => rules.stereotypes.has(s))) continue;
    if (rules.unlinked && !linked.has(t.id)) continue;
    types.push(rules.privateMembers ? withoutPrivate(t) : t);
  }
  const kept = new Set(types.map((t) => t.id));
  const relationships = model.relationships.filter((r) => kept.has(r.source) && kept.has(r.target));
  const notes = (model.notes ?? []).filter((n) => n.anchor === undefined || kept.has(n.anchor));
  const packages = model.packages.map((p) => {
    const typeIds = p.typeIds.filter((id) => kept.has(id));
    return typeIds.length === p.typeIds.length ? p : { ...p, typeIds };
  });
  return { model: { ...model, types, relationships, packages, notes }, display };
}
