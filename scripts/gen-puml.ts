// scripts/gen-puml.ts
// Genera un .puml sintético válido: npm run gen:puml -- --types 1000 --rels 2000 > big.puml

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : def;
}

const nTypes = Math.max(1, arg('types', 100));
const nRels = arg('rels', nTypes * 2);
const perPkg = 50;
const out: string[] = ['@startuml', 'skinparam classAttributeIconSize 0', 'set separator none'];

for (let i = 0; i < nTypes; i++) {
  if (i % perPkg === 0) {
    if (i > 0) out.push('}');
    const p = Math.floor(i / perPkg);
    out.push(`package "gen.p${p}" as pkg_gen_p${p} {`);
  }
  const r = i % 10;
  if (r === 0) {
    out.push(`  enum T${i} {`, '    UNO', '    DOS', '  }');
  } else if (r === 1) {
    out.push(`  record T${i} {`, '    + x: int', '    + y: int', '  }');
  } else if (r === 2) {
    out.push(`  interface T${i} {`, '    + run(): void', '  }');
  } else if (r === 3) {
    out.push(`  class T${i} {`, '    <<sealed>>', '    + area(): double', '  }');
  } else if (r === 4) {
    out.push(`  abstract class T${i} {`, '    # id: long', '    + calc(): double {abstract}', '  }');
  } else {
    out.push(
      `  class T${i} {`,
      '    - datos: Map<String, List<Integer>>',
      `    «create» + T${i}(datos: Map<String, List<Integer>>)`,
      '    + get(k: String): Integer',
      '  }',
    );
  }
}
out.push('}');

for (let k = 0; k < nRels; k++) {
  const a = k % nTypes;
  const b = (k * 7 + 1) % nTypes;
  out.push(`T${a} ${k % 2 === 0 ? '-->' : '..>'} T${b}`);
}
out.push('@enduml');
process.stdout.write(out.join('\n') + '\n');
