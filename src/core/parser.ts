// src/core/parser.ts
import type {
  AttributeModel,
  ConstructorModel,
  DeclaredKind,
  DiagramModel,
  MethodModel,
  PackageModel,
  ParameterModel,
  ParseIssue,
  RelType,
  RelationshipModel,
  TypeNode,
  Visibility,
} from './model';
import { classify } from './classify';

const DEFAULT_PACKAGE = '(default package)';
const EXTERNAL_PACKAGE = 'EXTERNAL';

// ---------- Regex precompiladas ----------
const RE_PACKAGE =
  /^package\b\s*(?:"([^"]*)"|([^\s{"]+))?(?:\s+as\s+([^\s{]+))?\s*(?:<<[^>]*>>\s*)*(\{)?\s*(\})?$/u;
const RE_TYPE =
  /^(abstract\s+class|abstract|class|interface|enum|record|annotation)\s+(?:"([^"]+)"|([^\s{"<]+(?:<(?!<)[^{}]*?>)?))(?:\s+as\s+([^\s{<]+))?\s*((?:<<[^>]+>>\s*)*)(\{)?\s*(\})?$/u;
const RE_STEREO_ALL = /<<\s*([^>]+?)\s*>>/gu;
const RE_STEREO_LINE = /^(?:<<\s*(.+?)\s*>>|«\s*(?!create)(.+?)\s*»)$/u;
const RE_MODIFIER = /\{\s*(static|abstract|classifier)\s*\}/gu;
const RE_CTOR = /^(?:«create»|<<create>>)\s*([+\-#~])?\s*([^\s(]+)\s*\((.*)\)\s*$/u;
const RE_METHOD = /^([+\-#~])?\s*([^\s(:]+)\s*\((.*)\)\s*(?::\s*(.*\S))?\s*$/u;
const RE_ATTR = /^([+\-#~])?\s*([^\s:(]+)\s*:\s*(.*\S)\s*$/u;
const RE_ATTR_JAVA = /^([+\-#~])?\s*(\S.*?)\s+([\p{L}_$][\p{L}\p{N}_$]*)$/u;
const RE_IDENT = /^([+\-#~])?\s*([\p{L}_$][\p{L}\p{N}_$]*)$/u;
const RE_ENUM_CONST = /^([\p{L}_$][\p{L}\p{N}_$]*)\s*(?:\(.*\))?\s*[,;]?$/u;
const RE_SEPARATOR = /^(?:--+|\.\.+|==+|__+)/u;
const RE_ABBREV = /^(?:…|\.\.\.)\s*(\d+)$/u;
const RE_REL_KW = /^("[^"]+"|[^\s":]+)\s+(extends|implements)\s+("[^"]+"|[^\s":]+)\s*$/u;
const RE_REL =
  /^("[^"]+"|[^\s":]+)\s+(?:"[^"]*"\s+)?(\S+)\s+(?:"[^"]*"\s+)?("[^"]+"|[^\s":]+)\s*(?::\s*(.*?))?\s*$/u;
const RE_ARROW =
  /^(<\|?|\*|o|\+|#|x|\^)?[-.](?:[-.]*(?:\[[^\]]*\])?(?:left|right|up|down|le|ri|do|l|r|u|d)?[-.]*)(\|>|>|\*|o|\+|#|x|\^)?$/u;
const RE_DIRECTIVE =
  /^(?:skinparam\b|set\s|title\b|hide\b|show\b|scale\b|left\s+to\s+right|top\s+to\s+bottom|header\b|footer\b|caption\b|allowmixing\b|together\b|!|@startuml\b|@enduml\b)/iu;
const RE_HIDE_MEMBERS = /^hide\s+members\b/iu;
const RE_NOTE_START = /^note\b/iu;
const RE_NOTE_END = /^end\s*note\b/iu;
const RE_PKG_ALIAS = /^(?:pkg|layer)_/u;

// ---------- Estructuras internas ----------
interface PkgAcc {
  name: string;
  typeIds: string[];
  isLayer: boolean;
  layer?: string;
}
type Frame =
  | { kind: 'package'; acc: PkgAcc; line: number }
  | { kind: 'type'; node: TypeNode; line: number }
  | { kind: 'skip'; line: number };

interface RawRel {
  left: string;
  right: string;
  type: RelType;
  reversed: boolean;
  label?: string;
  line: number;
}

const KIND_MAP: Record<string, DeclaredKind> = {
  class: 'class',
  abstract: 'abstract',
  interface: 'interface',
  enum: 'enum',
  record: 'record',
  annotation: 'annotation',
};

function unquote(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

/** Separa por comas respetando el anidamiento de <>, () y []. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '<' || ch === '(' || ch === '[') depth++;
    else if (ch === '>' || ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((p) => p.trim()).filter((p) => p.length > 0);
}

function parseParams(raw: string): { parameters: ParameterModel[]; abbreviated?: number } {
  const text = raw.trim();
  const abbr = RE_ABBREV.exec(text);
  if (abbr) return { parameters: [], abbreviated: Number(abbr[1]) };
  const parameters = splitTopLevel(text).map((p): ParameterModel => {
    const idx = p.indexOf(':');
    if (idx >= 0) return { name: p.slice(0, idx).trim(), type: p.slice(idx + 1).trim() };
    // Forma Java "Tipo nombre" o solo "Tipo"
    const sp = p.lastIndexOf(' ');
    if (sp > 0 && !p.slice(sp).includes('>')) return { name: p.slice(sp + 1), type: p.slice(0, sp).trim() };
    return { name: '', type: p };
  });
  return { parameters };
}

function toVis(v: string | undefined): Visibility {
  return (v ?? '+') as Visibility;
}

/** Interpreta una línea dentro del cuerpo de un tipo. Devuelve false si no se reconoce. */
function parseMember(raw: string, node: TypeNode): boolean {
  const st = RE_STEREO_LINE.exec(raw);
  if (st) {
    node.stereotypes.push((st[1] ?? st[2] ?? '').trim());
    return true;
  }
  if (RE_SEPARATOR.test(raw)) return true;

  let isStatic = false;
  let isAbstract = false;
  const line = raw
    .replace(RE_MODIFIER, (_m, mod: string) => {
      if (mod === 'abstract') isAbstract = true;
      else isStatic = true;
      return '';
    })
    .replace(/\s+/gu, ' ')
    .trim();
  if (!line) return false;

  const c = RE_CTOR.exec(line);
  if (c) {
    const p = parseParams(c[3] ?? '');
    const ctor: ConstructorModel = {
      name: c[2] ?? node.name,
      parameters: p.parameters,
      visibility: toVis(c[1]),
      ...(p.abbreviated !== undefined ? { parametersAbbreviated: p.abbreviated } : {}),
    };
    node.constructors.push(ctor);
    return true;
  }

  if (node.declaredKind === 'enum') {
    const ec = RE_ENUM_CONST.exec(line);
    if (ec && !/^[+\-#~]/u.test(line)) {
      node.enumConstants.push(ec[1] ?? line);
      return true;
    }
  }

  if (line.includes('(')) {
    const m = RE_METHOD.exec(line);
    if (!m) return false;
    const p = parseParams(m[3] ?? '');
    const method: MethodModel = {
      name: m[2] ?? '',
      returnType: (m[4] ?? 'void').trim(),
      parameters: p.parameters,
      visibility: toVis(m[1]),
      isStatic,
      isAbstract,
      ...(p.abbreviated !== undefined ? { parametersAbbreviated: p.abbreviated } : {}),
    };
    node.methods.push(method);
    return true;
  }

  const a = RE_ATTR.exec(line);
  if (a) {
    const attr: AttributeModel = { name: a[2] ?? '', type: (a[3] ?? '').trim(), visibility: toVis(a[1]), isStatic };
    node.attributes.push(attr);
    return true;
  }
  const id = RE_IDENT.exec(line);
  if (id) {
    node.attributes.push({ name: id[2] ?? '', type: '', visibility: toVis(id[1]), isStatic });
    return true;
  }
  const j = RE_ATTR_JAVA.exec(line);
  if (j) {
    node.attributes.push({ name: j[3] ?? '', type: (j[2] ?? '').trim(), visibility: toVis(j[1]), isStatic });
    return true;
  }
  return false;
}

/** Interpreta una flecha. null = no es flecha válida; 'hidden' = enlace oculto. */
function parseArrow(arrow: string): { type: RelType; reversed: boolean } | 'hidden' | null {
  if (/\[\s*hidden\s*\]/iu.test(arrow)) return 'hidden';
  const m = RE_ARROW.exec(arrow);
  if (!m) return null;
  const head = m[1] ?? '';
  const body = (m[2] ?? '').replace(/\[[^\]]*\]/gu, '');
  const tail = m[3] ?? '';
  const dashed = body.includes('.');
  if (head === '<|') return { type: dashed ? 'IMPLEMENTS' : 'EXTENDS', reversed: true };
  if (tail === '|>') return { type: dashed ? 'IMPLEMENTS' : 'EXTENDS', reversed: false };
  if (head === '<' && tail === '') return { type: dashed ? 'DEPENDENCY' : 'ASSOCIATION', reversed: true };
  return { type: dashed ? 'DEPENDENCY' : 'ASSOCIATION', reversed: false };
}

function newNode(
  id: string,
  name: string,
  packageName: string,
  declaredKind: DeclaredKind,
  line: number,
  implicit: boolean,
): TypeNode {
  return {
    id,
    name,
    packageName,
    declaredKind,
    category: 'class',
    isAbstract: declaredKind === 'abstract',
    isSealed: false,
    isExternal: false,
    implicit,
    stereotypes: [],
    attributes: [],
    methods: [],
    constructors: [],
    enumConstants: [],
    line,
  };
}

/** Parsea un .puml (dialecto de PlantUmlGenerator + PlantUML estándar) en una sola pasada. */
export function parsePuml(source: string): DiagramModel {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lines = text.split(/\r\n|\r|\n/u);
  const issues: ParseIssue[] = [];
  const types: TypeNode[] = [];
  const byId = new Map<string, TypeNode>();
  const nameToId = new Map<string, string | null>();
  const packages = new Map<string, PkgAcc>();
  const pkgRefs = new Set<string>();
  const rawRels: RawRel[] = [];
  const stack: Frame[] = [];
  let summaryMode = false;
  let inNote = false;

  const getPkg = (name: string): PkgAcc => {
    let acc = packages.get(name);
    if (!acc) {
      acc = { name, typeIds: [], isLayer: false };
      packages.set(name, acc);
    }
    return acc;
  };
  const currentPkg = (): PkgAcc | null => {
    for (let k = stack.length - 1; k >= 0; k--) {
      const f = stack[k];
      if (f && f.kind === 'package') return f.acc;
    }
    return null;
  };
  const warn = (line: number, message: string, severity: 'error' | 'warning' = 'warning'): void => {
    issues.push({ line, severity, message });
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = (lines[i] ?? '').replace(/\t/gu, ' ').trim();
    if (!line || line.startsWith("'")) continue;
    if (inNote) {
      if (RE_NOTE_END.test(line)) inNote = false;
      continue;
    }
    const top = stack[stack.length - 1];

    // --- Dentro de un tipo ---
    if (top && top.kind === 'type') {
      if (line === '}') {
        stack.pop();
        continue;
      }
      let content = line;
      let closes = false;
      if (content.endsWith('}') && !/\{[^}]*\}$/u.test(content)) {
        content = content.slice(0, -1).trim();
        closes = true;
      }
      if (content && !parseMember(content, top.node)) {
        warn(lineNo, `Miembro no reconocido en "${top.node.name}": ${line}`);
      }
      if (closes) stack.pop();
      continue;
    }

    // --- Bloque ignorado (skinparam { ... }) ---
    if (top && top.kind === 'skip') {
      if (line === '}') stack.pop();
      else if (line.endsWith('{')) stack.push({ kind: 'skip', line: lineNo });
      continue;
    }

    if (line === '}') {
      if (!top) warn(lineNo, 'Llave de cierre "}" sin apertura', 'error');
      else stack.pop();
      continue;
    }

    if (RE_DIRECTIVE.test(line)) {
      if (RE_HIDE_MEMBERS.test(line)) summaryMode = true;
      if (line.endsWith('{')) stack.push({ kind: 'skip', line: lineNo });
      continue;
    }

    if (RE_NOTE_START.test(line)) {
      if (!line.includes(':')) inNote = true;
      continue;
    }

    // --- Paquete ---
    const pm = RE_PACKAGE.exec(line);
    if (pm) {
      const name = pm[1] ?? pm[2] ?? DEFAULT_PACKAGE;
      const alias = pm[3];
      pkgRefs.add(name);
      if (alias) pkgRefs.add(alias);
      const parent = currentPkg();
      const acc = getPkg(name);
      if (parent) {
        parent.isLayer = true;
        acc.layer = parent.name;
      }
      if (!pm[4]) warn(lineNo, `Paquete "${name}" sin llave de apertura "{"`);
      else if (!pm[5]) stack.push({ kind: 'package', acc, line: lineNo });
      continue;
    }

    // --- Declaración de tipo ---
    const tm = RE_TYPE.exec(line);
    if (tm) {
      const kw = (tm[1] ?? 'class').split(/\s+/u)[0] ?? 'class';
      const declaredKind = KIND_MAP[kw] ?? 'class';
      const name = tm[2] ?? tm[3] ?? '';
      const id = tm[4] ?? name.replace(/<.*$/u, '');
      const pkg = currentPkg() ?? getPkg(DEFAULT_PACKAGE);
      const node = newNode(id, name, pkg.name, declaredKind, lineNo, false);
      if (pkg.name === EXTERNAL_PACKAGE) node.isExternal = true;
      const header = tm[5] ?? '';
      for (const s of header.matchAll(RE_STEREO_ALL)) node.stereotypes.push((s[1] ?? '').trim());

      if (byId.has(id)) {
        warn(lineNo, `Tipo duplicado "${id}" (primera declaración en la línea ${byId.get(id)?.line ?? '?'}); se ignora`);
      } else {
        byId.set(id, node);
        types.push(node);
        pkg.typeIds.push(id);
        const plain = name.replace(/<.*$/u, '');
        nameToId.set(plain, nameToId.has(plain) ? null : id);
      }
      if (tm[6] && !tm[7]) stack.push({ kind: 'type', node, line: lineNo });
      continue;
    }

    // --- Relaciones ---
    const kwm = RE_REL_KW.exec(line);
    if (kwm) {
      rawRels.push({
        left: unquote(kwm[1] ?? ''),
        right: unquote(kwm[3] ?? ''),
        type: kwm[2] === 'extends' ? 'EXTENDS' : 'IMPLEMENTS',
        reversed: false,
        line: lineNo,
      });
      continue;
    }
    const rm = RE_REL.exec(line);
    if (rm) {
      const arrow = parseArrow(rm[2] ?? '');
      if (arrow === 'hidden') continue;
      if (arrow) {
        const label = rm[4]?.trim();
        rawRels.push({
          left: unquote(rm[1] ?? ''),
          right: unquote(rm[3] ?? ''),
          type: arrow.type,
          reversed: arrow.reversed,
          line: lineNo,
          ...(label ? { label } : {}),
        });
        continue;
      }
    }

    warn(lineNo, `Línea no reconocida: ${line}`);
  }

  for (const f of stack) {
    warn(f.line, `Llave sin cerrar (abierta en la línea ${f.line})`, 'error');
  }

  // --- Resolución de extremos (crea nodos implícitos) ---
  const resolve = (ref: string, line: number): string | null => {
    if (byId.has(ref)) return ref;
    if (pkgRefs.has(ref) || RE_PKG_ALIAS.test(ref)) return null;
    const byName = nameToId.get(ref);
    if (byName) return byName;
    const node = newNode(ref, ref, DEFAULT_PACKAGE, 'class', line, true);
    byId.set(ref, node);
    types.push(node);
    return ref;
  };

  const relationships: RelationshipModel[] = [];
  for (const r of rawRels) {
    const l = resolve(r.left, r.line);
    const rt = resolve(r.right, r.line);
    if (l === null || rt === null) continue;
    relationships.push({
      source: r.reversed ? rt : l,
      target: r.reversed ? l : rt,
      type: r.type,
      line: r.line,
      ...(r.label !== undefined ? { label: r.label } : {}),
    });
  }

  // --- Finalización: flags y categoría ---
  for (const t of types) {
    const st = t.stereotypes.map((s) => s.toLowerCase());
    t.isSealed = st.includes('sealed');
    t.isExternal = t.isExternal || st.includes('external') || t.packageName === EXTERNAL_PACKAGE;
    t.category = classify(t);
  }

  const packageList: PackageModel[] = [];
  for (const p of packages.values()) {
    if (p.isLayer && p.typeIds.length === 0) continue;
    packageList.push({
      name: p.name,
      typeIds: [...p.typeIds].sort((a, b) => a.localeCompare(b)),
      ...(p.layer !== undefined ? { layer: p.layer } : {}),
    });
  }

  return { types, relationships, packages: packageList, summaryMode, issues };
}
