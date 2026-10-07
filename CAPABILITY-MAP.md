# Capability Map: AutoUML

> Fuente de verdad del alcance (SDD Fase 0). Aprobada antes de escribir specs por módulo.
> Skill aplicada: `addyosmani/agent-skills@spec-driven-development` (49.6K installs) + `mattpocock/skills@to-spec` (622K installs) como referencia de síntesis.

## Módulos

| Module id          | Responsabilidad                                                        | Depends on                  |
|--------------------|------------------------------------------------------------------------|-----------------------------|
| `app-shell`        | Shell Electron + React, ventanas, FS, config, persistencia base        | —                           |
| `java-ingest`      | Selección proyecto Java, parse, modelo intermedio, genera `.puml`      | `app-shell`                 |
| `puml-io-history`  | Abrir/guardar `.puml`, historial de proyectos abiertos                 | `app-shell`                 |
| `puml-viewer`      | Render en tiempo real del `.puml`, virtualización para 500+ entidades   | `app-shell`, `java-ingest`, `puml-io-history` |
| `canvas-interaction`| Menú/paleta drag & drop, selección, mover, editar entidades            | `puml-viewer`               |

Build order: `app-shell` → `java-ingest`, `puml-io-history` → `puml-viewer` → `canvas-interaction`

## Reglas

- Ids estables en kebab-case, no renombrar a mitad de iniciativa.
- Dependencias acíclicas. Si dos módulos se necesitan mutuamente, son un solo módulo.
- Los contratos entre módulos viven en el spec del proveedor (ej. el formato del modelo `.puml` intermedio se define en `SPEC-java-ingest.md`, el contrato de render en `SPEC-puml-viewer.md`).
- Cada módulo tiene su spec en `specs/SPEC-<id>.md`. El spec global vive en `SPEC.md`.

## Trazabilidad

- `SPEC.md` → visión global, stack, comandos, estructura, estilo, testing, límites, criterios de éxito.
- `specs/SPEC-app-shell.md`, `SPEC-java-ingest.md`, `SPEC-puml-io-history.md`, `SPEC-puml-viewer.md`, `SPEC-canvas-interaction.md` → un spec por módulo.
