// src/application/puml/parser.ts
import type {
  AttributeModel,
  ConstructorModel,
  DeclaredKind,
  DiagramModel,
  HeadType,
  MethodModel,
  NoteModel,
  NotePosition,
  PackageModel,
  ParameterModel,
  ParseIssue,
  RelType,
  RelationshipModel,
  TypeNode,
  Visibility,
} from '../../domain/diagram/model';
import { classify } from '../../domain/diagram/classify';
import { SkinparamReader } from '../../domain/diagram/skinparam';

const DEFAULT_PACKAGE = '(default package)';
const EXTERNAL_PACKAGE = 'EXTERNAL';

// ---------- Regex precompiladas ----------
const RE_PACKAGE =
  /^(package|namespace)\b\s*(?:"([^"]*)"|([^\s{"]+))?(?:\s+as\s+([^\s{]+))?\s*(?:<<[^>]*>>\s*)*(\{)?\s*(\})?$/u;
const RE_TYPE =
  /^(abstract\s+class|abstract|class|interface|enum|record|annotation|struct|entity|exception|protocol|object|circle|diamond|metaclass|stereotype|dataclass)\s+(?:"([^"]+)"|([^\s{"<]+(?:<(?!<)[^{}]*?>)?))(?:\s+as\s+([^\s{<]+))?\s*((?:<<[^>]+>>\s*)*)(?:extends\s+([^\s{]+(?:\s*,\s*[^\s{]+)*)\s*)?(?:implements\s+([^\s{]+(?:\s*,\s*[^\s{]+)*)\s*)?(\{)?\s*(\})?$/u;
const RE_TYPE_START =
  /^(?:abstract|class|interface|enum|record|annotation|struct|entity|exception|protocol|object|circle|diamond|metaclass|stereotype|dataclass)\b/u;
const CORE_KINDS = new Set<string>(['class', 'abstract', 'interface', 'enum', 'record', 'annotation']);
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
  /^("[^"]+"|(?:[^\s":]|::)+)\s+(?:"([^"]*)"\s+)?(\S+)\s+(?:"([^"]*)"\s+)?("[^"]+"|(?:[^\s":]|::)+)\s*(?::\s*(.*?))?\s*$/u;
const RE_ASSOC_CLASS =
  /^\(\s*("[^"]+"|[^\s",)]+)\s*,\s*("[^"]+"|[^\s",)]+)\s*\)\s*(?:\.\.|--)\s*("[^"]+"|[^\s":]+)\s*$/u;
const RE_ASSOC_CLASS_REV =
  /^("[^"]+"|[^\s":]+)\s*(?:\.\.|--)\s*\(\s*("[^"]+"|[^\s",)]+)\s*,\s*("[^"]+"|[^\s",)]+)\s*\)\s*$/u;
const RE_HEADER_COLOR = /\s(#[^\s{}<]+)/u;
const RE_ARROW =
  // Grupos: 1 = cabeza, 2 = cuerpo (guiones/puntos, para distinguir línea continua o punteada), 3 = punta.
  /^(<\|?|\*|o|\+|#|x|\^)?([-.][-.]*(?:\[[^\]]*\])?(?:left|right|up|down|le|ri|do|l|r|u|d)?[-.]*)(\|>|>|\*|o|\+|#|x|\^)?$/u;
const RE_DIRECTIVE =
  /^(?:skinparam\b|set\s|title\b|hide\b|show\b|remove\b|scale\b|left\s+to\s+right|top\s+to\s+bottom|header\b|footer\b|caption\b|allowmixing\b|together\b|!|@startuml\b|@enduml\b)/iu;
const RE_HIDE_MEMBERS = /^hide\s+members\b/iu;
const RE_HIDE_RULE = /^(?:hide|show|remove)\s+\S/iu;
const RE_DIR_LR = /^left\s+to\s+right\s+direction\b/iu;
const RE_DIR_TB = /^top\s+to\s+bottom\s+direction\b/iu;
const RE_PREPROC = /^!/u;
const RE_LAYER_ALIAS = /^layer_/u;
const RE_NOTE_START = /^note\b/iu;
const RE_NOTE_END = /^end\s*note\b/iu;
const RE_NOTE_SINGLE = /^note\s+"([^"]*)"\s+as\s+([\p{L}\p{N}_$]+)\s*(?:#\S+)?\s*$/iu;
const RE_NOTE_AS = /^note\s+as\s+([\p{L}\p{N}_$]+)\s*(?:#\S+)?\s*$/iu;
const RE_NOTE_LINK = /^note\s+(?:left\s+|right\s+|top\s+|bottom\s+)?on\s+link\b\s*(?:#\S+\s*)?(?::\s*(.*\S))?\s*$/iu;
const RE_NOTE_POS =
  /^note\s+(left|right|top|bottom|over)\b(?:\s+of)?\s*([^:#]*?)\s*(?:#\S+\s*)?(?::\s*(.*\S))?\s*$/iu;
const RE_PKG_ALIAS = /^(?:pkg|layer)_/u;

// ---------- Estructuras internas ----------
interface PkgAcc {
  name: string;
  typeIds: string[];
  isLayer: boolean;
  layer?: string;
  alias?: string;
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
  leftHead: HeadType;
  rightHead: HeadType;
  leftLabel?: string;
  rightLabel?: string;
  hint?: 'up' | 'down' | 'left' | 'right';
  style?: { color?: string; bold?: boolean; dashed?: boolean };
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
  struct: 'struct',
  entity: 'entity',
  exception: 'exception',
  protocol: 'protocol',
  object: 'object',
  circle: 'circle',
  diamond: 'diamond',
  metaclass: 'metaclass',
  stereotype: 'stereotype',
  dataclass: 'dataclass',
};

const HEADS: Record<string, HeadType> = {
  '<': 'open',
  '>': 'open',
  '<|': 'triangle',
  '|>': 'triangle',
  '^': 'triangle',
  '*': 'diamond-filled',
  o: 'diamond',
  '+': 'plus',
  '#': 'square',
  x: 'cross',
};

const HINTS: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  up: 'up',
  u: 'up',
  down: 'down',
  do: 'down',
  d: 'down',
  left: 'left',
  le: 'left',
  l: 'left',
  right: 'right',
  ri: 'right',
  r: 'right',
};
const INVERSE = { up: 'down', down: 'up', left: 'right', right: 'left' } as const;

const normColor = (c: string): string => (/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(c) ? `#${c}` : c);

interface Arrow {
  type: RelType;
  reversed: boolean;
  leftHead: HeadType;
  rightHead: HeadType;
  hint?: 'up' | 'down' | 'left' | 'right';
  style?: { color?: string; bold?: boolean; dashed?: boolean };
}

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
function parseArrow(arrow: string): Arrow | 'hidden' | null {
  if (/\[\s*hidden\s*\]/iu.test(arrow)) return 'hidden';
  const m = RE_ARROW.exec(arrow);
  if (!m) return null;
  const head = m[1] ?? '';
  const body = (m[2] ?? '').replace(/\[[^\]]*\]/gu, '');
  const tail = m[3] ?? '';
  const dashed = body.includes('.');
  const hintWord = /[-.](left|right|up|down|le|ri|do|l|r|u|d)(?=[-.]|$)/u.exec(body)?.[1];
  const style: NonNullable<Arrow['style']> = {};
  for (const tok of (/\[([^\]]*)\]/u.exec(m[2] ?? '')?.[1] ?? '').split(',')) {
    const t = tok.trim();
    if (t.startsWith('#')) style.color = normColor(t.slice(1));
    else if (t === 'bold') style.bold = true;
    else if (t === 'dashed' || t === 'dotted') style.dashed = true;
  }
  const heads = {
    leftHead: HEADS[head] ?? 'none',
    rightHead: HEADS[tail] ?? 'none',
    ...(hintWord ? { hint: HINTS[hintWord] } : {}),
    ...(Object.keys(style).length ? { style } : {}),
  };
  const plain: RelType = dashed ? 'DEPENDENCY' : 'ASSOCIATION';
  const ext: RelType = dashed ? 'IMPLEMENTS' : 'EXTENDS';
  const whole = (k: string): RelType => (k === '*' ? 'COMPOSITION' : 'AGGREGATION');
  if (head === '<|') return { type: ext, reversed: true, ...heads };
  if (tail === '|>') return { type: ext, reversed: false, ...heads };
  if (head === '*' || head === 'o') return { type: whole(head), reversed: false, ...heads };
  if (tail === '*' || tail === 'o') return { type: whole(tail), reversed: true, ...heads };
  if (head === '<' && tail === '') return { type: plain, reversed: true, ...heads };
  return { type: plain, reversed: false, ...heads };
}

/** Extrae "#color;line:borde" / "#fill##borde" de la cabecera de un tipo (ignora lo entrecomillado). */
function extractHeaderColor(line: string): { text: string; color?: string; lineColor?: string } {
  const masked = line.replace(/"[^"]*"/gu, (q) => '_'.repeat(q.length));
  const m = RE_HEADER_COLOR.exec(masked);
  if (!m || !m[1]) return { text: line };
  const start = m.index + 1;
  const spec = line.slice(start, start + m[1].length);
  const text = line.slice(0, start) + line.slice(start + spec.length);
  const [fillPart = '', borderPart] = spec.startsWith('##') ? ['', spec.slice(2)] : spec.slice(1).split('##');
  const norm = normColor;
  let color: string | undefined;
  let lineColor: string | undefined;
  fillPart.split(';').forEach((tok, idx) => {
    const t = tok.trim();
    if (t.startsWith('line:')) lineColor = norm(t.slice(5));
    else if (t.startsWith('back:')) color = norm(t.slice(5));
    else if (idx === 0 && t && !t.includes(':') && !t.includes('.')) color = norm(t.split('/')[0] ?? t);
  });
  if (borderPart) lineColor = norm(borderPart.replace(/^\[[^\]]*\]/u, ''));
  return { text, ...(color ? { color } : {}), ...(lineColor ? { lineColor } : {}) };
}

/** Cabecera de nota. multiline = el texto sigue hasta "end note". null = forma desconocida. */
function parseNoteHeader(
  line: string,
  lineNo: number,
  lastTypeId: string | null,
  lastRelLine: number | undefined,
): { note: NoteModel; multiline: boolean } | null {
  const base = (id: string, text: string, extra: Partial<NoteModel> = {}): NoteModel => ({
    id,
    text,
    line: lineNo,
    ...extra,
  });
  const s = RE_NOTE_SINGLE.exec(line);
  if (s) return { note: base(s[2] ?? `note_${lineNo}`, s[1] ?? ''), multiline: false };
  const f = RE_NOTE_AS.exec(line);
  if (f) return { note: base(f[1] ?? `note_${lineNo}`, ''), multiline: true };
  const k = RE_NOTE_LINK.exec(line);
  if (k) {
    const extra: Partial<NoteModel> = lastRelLine !== undefined ? { linkLine: lastRelLine } : {};
    return { note: base(`note_${lineNo}`, k[1] ?? '', extra), multiline: k[1] === undefined };
  }
  const p = RE_NOTE_POS.exec(line);
  if (p) {
    const anchor = splitTopLevel(p[2] ?? '').map(unquote)[0] ?? lastTypeId ?? undefined;
    const pos = (p[1] ?? '').toLowerCase();
    const extra: Partial<NoteModel> = {
      ...(pos !== 'over' ? { position: pos as NotePosition } : {}),
      ...(anchor ? { anchor } : {}),
    };
    return { note: base(`note_${lineNo}`, p[3] ?? '', extra), multiline: p[3] === undefined };
  }
  return null;
}

/** Separa la flecha de sentido de una etiqueta ("usa >", "< usa"); normaliza a source→target. */
function splitLabelArrow(
  label: string | undefined,
  reversed: boolean,
): { label?: string; arrow?: 'forward' | 'backward' } {
  if (label === undefined) return {};
  const m = /^(.*\S)\s+([<>])$/u.exec(label) ?? /^([<>])\s+(.*\S)$/u.exec(label);
  if (!m) return { label };
  const [text, dir] = /^[<>]$/u.test(m[1] ?? '') ? [m[2] ?? '', m[1]] : [m[1] ?? '', m[2]];
  const toRight = dir === '>';
  return { label: text, arrow: toRight !== reversed ? 'forward' : 'backward' };
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
  let noteBody: NoteModel | null = null;
  let noteLine = 0;
  let lastTypeId: string | null = null;
  let direction: 'TB' | 'LR' = 'TB';
  const notes: NoteModel[] = [];
  const hide: string[] = [];
  const skin = new SkinparamReader();
  const qualified = new Map<string, string>();
  const rawAssoc: { left: string; right: string; cls: string; line: number }[] = [];

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
      if (RE_NOTE_END.test(line)) {
        inNote = false;
        noteBody = null;
      } else if (noteBody) noteBody.text += (noteBody.text ? '\n' : '') + line;
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

    // --- skinparam (línea suelta o bloque); antes del "}" genérico porque el bloque lo cierra él ---
    if (skin.feed(line, lineNo)) continue;

    if (line === '}') {
      if (!top) warn(lineNo, 'Llave de cierre "}" sin apertura', 'error');
      else stack.pop();
      continue;
    }

    if (RE_DIRECTIVE.test(line)) {
      if (RE_HIDE_MEMBERS.test(line)) summaryMode = true;
      if (RE_HIDE_RULE.test(line)) hide.push(line);
      if (RE_DIR_LR.test(line)) direction = 'LR';
      else if (RE_DIR_TB.test(line)) direction = 'TB';
      else if (RE_PREPROC.test(line)) warn(lineNo, `Directiva de preprocesador no soportada: ${line}`);
      if (line.endsWith('{')) stack.push({ kind: 'skip', line: lineNo });
      continue;
    }

    if (RE_NOTE_START.test(line)) {
      const nh = parseNoteHeader(line, lineNo, lastTypeId, rawRels[rawRels.length - 1]?.line);
      if (nh) {
        notes.push(nh.note);
        if (nh.multiline) {
          inNote = true;
          noteBody = nh.note;
          noteLine = lineNo;
        }
      } else if (!line.includes(':')) {
        inNote = true; // forma desconocida: se ignora el cuerpo
        noteLine = lineNo;
      }
      continue;
    }

    // --- Paquete ---
    const pm = RE_PACKAGE.exec(line);
    if (pm) {
      const parent = currentPkg();
      const local = pm[2] ?? pm[3] ?? DEFAULT_PACKAGE;
      // Anidado: nombre completo (com.foo + bar → com.foo.bar), salvo bajo una capa del generador (layer_N).
      const composed = parent && !RE_LAYER_ALIAS.test(parent.alias ?? '') && !local.startsWith(`${parent.name}.`);
      const name = composed ? `${parent.name}.${local}` : local;
      const alias = pm[4];
      pkgRefs.add(name);
      if (alias) pkgRefs.add(alias);
      const acc = getPkg(name);
      if (alias) acc.alias = alias;
      if (parent) {
        parent.isLayer = true;
        acc.layer = parent.name;
      }
      if (!pm[5]) warn(lineNo, `${pm[1]?.toLowerCase() === 'namespace' ? 'Namespace' : 'Paquete'} "${name}" sin llave de apertura "{"`);
      else if (!pm[6]) stack.push({ kind: 'package', acc, line: lineNo });
      continue;
    }

    // --- Declaración de tipo ---
    const hc = RE_TYPE_START.test(line) ? extractHeaderColor(line) : null;
    const tm = RE_TYPE.exec(hc?.text ?? line);
    if (tm) {
      const kw = (tm[1] ?? 'class').split(/\s+/u)[0] ?? 'class';
      const declaredKind = KIND_MAP[kw] ?? 'class';
      const name = tm[2] ?? tm[3] ?? '';
      const id = tm[4] ?? name.replace(/<.*$/u, '');
      const pkg = currentPkg() ?? getPkg(DEFAULT_PACKAGE);
      const node = newNode(id, name, pkg.name, declaredKind, lineNo, false);
      if (pkg.name === EXTERNAL_PACKAGE) node.isExternal = true;
      if (hc?.color) node.color = hc.color;
      if (hc?.lineColor) node.lineColor = hc.lineColor;
      const header = tm[5] ?? '';
      for (const s of header.matchAll(RE_STEREO_ALL)) node.stereotypes.push((s[1] ?? '').trim());
      if (!CORE_KINDS.has(declaredKind)) node.stereotypes.unshift(declaredKind);

      if (byId.has(id)) {
        warn(lineNo, `Tipo duplicado "${id}" (primera declaración en la línea ${byId.get(id)?.line ?? '?'}); se ignora`);
      } else {
        byId.set(id, node);
        types.push(node);
        pkg.typeIds.push(id);
        const plain = name.replace(/<.*$/u, '');
        nameToId.set(plain, nameToId.has(plain) ? null : id);
        if (pkg.name !== DEFAULT_PACKAGE) qualified.set(`${pkg.name}.${plain}`, id);
        // "class A extends B implements I, J" en la propia declaración
        for (const [list, type] of [[tm[6], 'EXTENDS'], [tm[7], 'IMPLEMENTS']] as const) {
          for (const ref of (list ?? '').split(/\s*,\s*/u).filter(Boolean)) {
            rawRels.push({
              left: id,
              right: unquote(ref),
              type,
              reversed: false,
              leftHead: 'none',
              rightHead: 'triangle',
              line: lineNo,
            });
          }
        }
      }
      lastTypeId = id;
      if (tm[8] && !tm[9]) stack.push({ kind: 'type', node, line: lineNo });
      continue;
    }

    // --- Clase asociación: (A, B) .. C ---
    const ac = RE_ASSOC_CLASS.exec(line);
    const acr = ac ? null : RE_ASSOC_CLASS_REV.exec(line);
    if (ac || acr) {
      const [l, r, c] = ac ? [ac[1], ac[2], ac[3]] : [acr?.[2], acr?.[3], acr?.[1]];
      rawAssoc.push({ left: unquote(l ?? ''), right: unquote(r ?? ''), cls: unquote(c ?? ''), line: lineNo });
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
        leftHead: 'none',
        rightHead: 'triangle',
        line: lineNo,
      });
      continue;
    }
    const rm = RE_REL.exec(line);
    if (rm) {
      const arrow = parseArrow(rm[3] ?? '');
      if (arrow === 'hidden') continue;
      if (arrow) {
        const label = rm[6]?.trim();
        rawRels.push({
          left: unquote(rm[1] ?? ''),
          right: unquote(rm[5] ?? ''),
          type: arrow.type,
          reversed: arrow.reversed,
          leftHead: arrow.leftHead,
          rightHead: arrow.rightHead,
          line: lineNo,
          ...(arrow.hint ? { hint: arrow.hint } : {}),
          ...(arrow.style ? { style: arrow.style } : {}),
          ...(rm[2] ? { leftLabel: rm[2] } : {}),
          ...(rm[4] ? { rightLabel: rm[4] } : {}),
          ...(label ? { label } : {}),
        });
        continue;
      }
    }

    warn(lineNo, `Línea no reconocida: ${line}`);
  }

  if (inNote) warn(noteLine, 'Nota sin cerrar (falta "end note")', 'error');
  skin.finish();
  for (const w of skin.warnings) warn(w.line, w.message);
  for (const f of stack) {
    warn(f.line, `Llave sin cerrar (abierta en la línea ${f.line})`, 'error');
  }

  // --- Resolución de extremos (crea nodos implícitos) ---
  const resolve = (ref: string, line: number): string | null => {
    if (byId.has(ref)) return ref;
    if (pkgRefs.has(ref) || RE_PKG_ALIAS.test(ref)) return null;
    const byName = qualified.get(ref) ?? nameToId.get(ref);
    if (byName) return byName;
    const node = newNode(ref, ref, DEFAULT_PACKAGE, 'class', line, true);
    byId.set(ref, node);
    types.push(node);
    return ref;
  };

  const lookup = (ref: string): string | null => (byId.has(ref) ? ref : (qualified.get(ref) ?? nameToId.get(ref) ?? null));
  /** "A::campo" → ["A", "campo"], salvo que "A::campo" sea un tipo declarado. */
  const splitMember = (ref: string): [string, string | undefined] => {
    const i = ref.lastIndexOf('::');
    return i > 0 && !byId.has(ref) && !qualified.has(ref) ? [ref.slice(0, i), ref.slice(i + 2)] : [ref, undefined];
  };
  const noteById = new Map(notes.map((n) => [n.id, n] as const));

  const relationships: RelationshipModel[] = [];
  for (const r of rawRels) {
    // "N1 .. Tipo": ancla la nota, no es una relación
    const note = noteById.get(r.left) ?? noteById.get(r.right);
    if (note) {
      note.anchor ??= noteById.has(r.left) ? r.right : r.left;
      continue;
    }
    const [lRef, lMember] = splitMember(r.left);
    const [rRef, rMember] = splitMember(r.right);
    const l = resolve(lRef, r.line);
    const rt = resolve(rRef, r.line);
    if (l === null || rt === null) continue;
    const sw = r.reversed;
    const hint = r.hint && sw ? INVERSE[r.hint] : r.hint;
    const sMember = sw ? rMember : lMember;
    const tMember = sw ? lMember : rMember;
    const lab = splitLabelArrow(r.label, sw);
    const sLabel = sw ? r.rightLabel : r.leftLabel;
    const tLabel = sw ? r.leftLabel : r.rightLabel;
    relationships.push({
      source: sw ? rt : l,
      target: sw ? l : rt,
      type: r.type,
      sourceHead: sw ? r.rightHead : r.leftHead,
      targetHead: sw ? r.leftHead : r.rightHead,
      line: r.line,
      ...(lab.label !== undefined ? { label: lab.label } : {}),
      ...(lab.arrow ? { labelArrow: lab.arrow } : {}),
      ...(sLabel ? { sourceLabel: sLabel } : {}),
      ...(tLabel ? { targetLabel: tLabel } : {}),
      ...(hint ? { hint } : {}),
      ...(r.style ? { style: r.style } : {}),
      ...(sMember ? { sourceMember: sMember } : {}),
      ...(tMember ? { targetMember: tMember } : {}),
    });
  }

  // "(A, B) .. C": marca la relación A–B con su clase asociación (si no existe, la crea sin cabezas)
  for (const a of rawAssoc) {
    const src = resolve(a.left, a.line);
    const tgt = resolve(a.right, a.line);
    const cls = resolve(a.cls, a.line);
    if (!src || !tgt || !cls) continue;
    let rel = relationships.find((r) => (r.source === src && r.target === tgt) || (r.source === tgt && r.target === src));
    if (!rel) {
      rel = { source: src, target: tgt, type: 'ASSOCIATION', sourceHead: 'none', targetHead: 'none', line: a.line };
      relationships.push(rel);
    }
    rel.associationClass = cls;
  }

  for (const n of notes) {
    if (n.anchor === undefined) continue;
    const id = lookup(n.anchor);
    if (id) n.anchor = id;
    else {
      warn(n.line, `Nota anclada a un tipo no declarado: ${n.anchor}`);
      delete n.anchor;
    }
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

  return {
    types,
    relationships,
    packages: packageList,
    summaryMode,
    issues,
    notes,
    hide,
    direction,
    skinparams: skin.values,
  };
}
