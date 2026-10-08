# SPEC-java-ingest: Proyecto Java → modelo → .puml (vía librería existente)

> Módulo: `java-ingest` · Depende de: `app-shell` · Provee el `.puml`/modelo a `puml-viewer`.
> Librería reutilizada: `../ProyectParser/proyect-parser-core` (Java 17+, JavaParser 3.28.2, `DiagramFacade` + `DiagramFilter` + `DiagramOptions`, flujo 3 fases en `docs/flujo-3-fases.md`).

## Objective

Dada una carpeta con `.java`, producir el **`.puml` de diagrama de clases** invocando la librería existente como **sidecar JAR**, sin reimplementar el parseo en JS. Relaciones soportadas (las que ya infiere la librería): `EXTENDS`, `IMPLEMENTS`, `ASSOCIATION` (atributos + genéricos), `DEPENDENCY` (firmas), cajas `@external`, filtros blacklist>whitelist y flags `--no-getters --no-attributes --no-methods --no-constructors --no-external --no-jdk --flat`.

Historias: como estudiante selecciono mi proyecto y obtengo el diagrama sin configurar nada; como docente cargo proyectos de 100+ archivos sin que la UI se congele.

## Tech Stack

- Sidecar: `proyect-parser-core.jar` + `javaparser-core.jar` en `resources/parser/`, ejecutado desde Electron main con `child_process.spawn('java', ['-cp', '<jars>', '<bridgeMain>', src, salida, flags])`.
- **Bridge headless a crear** en repo `ProyectParser` (ej. `com.proyectparser.bridge.AutoUmlBridge` con `main` no-interactivo: args posicionales + flags `AppGenerador`, exit codes, resumen `parsed X/Y, failed Z` en stdout/JSON). `AppGenerador` NO reutilizable como sidecar (interactivo con `Scanner`).
- Requisito runtime: JRE 17+ (detectado al arrancar: `java -version`; error guiado si falta). Empaquetar JRE: decisión abierta.
- `zod` para validar el resumen/contrato; `chokidar` para re-parse con debounce ante cambios.

## Commands

```bash
npm test -- tests/java-ingest
# Contrato del sidecar (verificación manual):
java -cp "resources/parser/*" com.proyectparser.bridge.AutoUmlBridge "ruta/a/src" /tmp/out.puml --no-getters
```

## Project Structure

```text
resources/parser/            → Sidecar versionado (proyect-parser-core.jar + javaparser-core.jar + PARSER_VERSION.txt)
apps/desktop/main/parser/    → parser-service.ts (spawn java, timeout, cola, parse de resumen), java-runtime.ts (detección JRE)
src/lib/puml-model.ts        → Tipos UmlModel espejo del modelo Java (solo lo necesario para viewer/interacción)
src/stores/diagramStore.ts   → Estado: srcPath, pumlText, diagnostics, stats, filtros/opciones
tests/java-ingest/           → Servicio mockeado (fake bridge) + fixtures .puml reales de la librería
```

## Code Style

El renderer jamás invoca `java` directamente: solo vía `window.autouml.parseProject(...)` (preload → IPC → main). Timeouts y cancelación obligatorios; un `.java` roto no aborta (la librería ya lo registra en `getFailedFiles()` → se expone en `diagnostics`). Ejemplo:

```ts
// apps/desktop/main/parser/parser-service.ts — único lugar que hace spawn
export async function generatePuml(srcDir: string, opts: DiagramOpts): Promise<ParseResult> {
  // valida srcDir, construye argv del bridge, spawn java con timeout, recoge .puml + resumen
}
```

## Testing Strategy

Vitest con **bridge fake** (script Node que emite `.puml` fixture + resumen): servicio (timeout, cancelación, debounce), store (filtros/opciones → argv), errores (sin JRE, carpeta inexistente, archivo roto). E2E real (con JRE) solo en CI con Java: fixture `tests/fixtures/sample-java/` → `.puml` válido con `EXTENDS/IMPLEMENTS`. Cobertura ≥ 80% en `parser-service` + `diagramStore`.

## Boundaries

- Always: pin de versión del sidecar (`PARSER_VERSION.txt` + checksum); argv construido desde `DiagramFilter`/`DiagramOptions` validados; `.puml` tratado como artefacto derivado (determinista según la librería).
- Ask first: actualizar el JAR del sidecar, añadir flags nuevos del bridge, empaquetar/descargar JRE, caché incremental del modelo.
- Never: reimplementar el parseo Java en TS; ejecutar código del proyecto analizado; enviar fuentes a red; invocar `AppGenerador` interactivo como sidecar.

## Success Criteria

- [ ] Carpeta con 50 clases reales → `.puml` generado vía sidecar y renderizado, TTI < 5 s.
- [ ] Archivo `.java` inválido → aparece en `diagnostics` (`failed Z`), resto del diagrama intacto.
- [ ] Cambio en 1 archivo → re-parse con debounce + nuevo `.puml` < 1 s (< 100 entidades).
- [ ] Sin JRE → error guiado (cómo instalar), sin crash.
- [ ] Versión del sidecar visible en UI/Acerca de y verificada al arrancar.

## Open Questions

1. ¿Quién compila y versiona el bridge headless (nuevo módulo Maven `proyect-parser-bridge` con fat-jar vs copiar JARs + clase suelta)?
2. ¿JRE empaquetado (jlink/jpackage) o requisito de instalación con descarga guiada?
3. ¿Exponer filtros `DiagramFilter`/veto de relaciones del CLI en la UI v1 o solo flags de visualización?
4. ¿Incluir miembros privados por defecto o colapsados (mapea a `DiagramOptions`)?
