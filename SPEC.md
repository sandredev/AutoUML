# Spec: AutoUML — visor y editor UML desde proyectos Java (React + Electron)

## Objective

Construir **AutoUML**, software de escritorio (Windows/Linux/macOS) con **React + Electron** que:

1. Recibe un **proyecto Java** (carpeta), lo analiza y **construye el `.puml`** (diagramas de clases: clases, interfaces, enums, relaciones de herencia/implementación/asociación/uso).
2. **Renderiza el diagrama en tiempo real** ante cambios del modelo/fuente.
3. Permite **cargar archivos `.puml` ya hechos** y visualizarlos.
4. Muestra el **historial de proyectos abiertos** con anterioridad (reapertura en 1 clic).
5. Ofrece un **menú/paleta drag & drop** para interactuar con las entidades del `.puml` (agregar, mover, conectar, editar/eliminar).
6. Está **preparado para renderizar más de 500 entidades** sin congelar la UI (virtualización, incrementalismo, debounce).

**Usuarios:** estudiantes/docentes de Ing. de Software. **Éxito:** abrir un proyecto Java real, ver su diagrama de clases en < X s, editar por drag & drop, guardar/cargar `.puml`, y reabrir desde historial.

ASSUMPTIONS I'M MAKING (corregir ahora o se procede con estas):

1. Desktop con Electron + React + TypeScript + Vite (electron-vite). No web-only ni Tauri.
2. Parseo Java **reutilizando la librería existente `proyect-parser-core`** (repo hermano `../ProyectParser`, Java 17+, JavaParser 3.28.2, API `DiagramFacade` + `DiagramFilter` + `DiagramOptions`). Electron la invoca como **sidecar JAR vía `child_process`** desde el main process; el renderer jamás invoca Java directamente.
   - El JAR actual es **librería sin `Main-Class`** → se requiere un **bridge headless no-interactivo** (nueva clase `main` en `ProyectParser`, ej. `AutoUmlBridge`: args `src salida.puml [flags]` + resumen `parsed X/Y, failed Z` por stdout/JSON). `AppGenerador` NO sirve como sidecar (es interactivo con `Scanner`).
   - JRE 17+ requerido en la máquina objetivo (se detecta al arrancar; empaquetar JRE queda como decisión abierta).
3. Render PlantUML **offline/local** (JAR embebido o `plantuml-encoder` + SVG local), sin depender de plantuml.com por privacidad/offline universitario.
4. Solo diagrama de **clases** en v1 (secuencia/otros quedan fuera). Tipos de relación los que ya infiere la librería: `EXTENDS`, `IMPLEMENTS`, `ASSOCIATION`, `DEPENDENCY` (+ cajas `@external`).
5. Historial y settings locales (`electron-store` o SQLite vía `better-sqlite3`); límite 20–50 entradas.
6. Drag & drop edita el **modelo intermedio** y regenera `.puml` (el `.puml` es artefacto derivado versionable, no se edita como texto libre en v1 salvo vista read-only).

## Tech Stack

- **Shell:** Electron ≥ 30, `electron-vite`, `electron-builder` (nsis/deb/dmg).
- **UI:** React 18+, TypeScript strict, Vite, estado con Zustand (UI/modelo ligero) + worker para parse/render.
- **Render UML:** estrategia a decidir en Plan: (A) PlantUML local (JAR + Java runtime embebido o requerido) → SVG/PNG; (B) parser `.puml` propio → grafo (Cytoscape.js / React Flow / elkjs) para soportar 500+ nodos con virtualización. Recomendación inicial: **B para canvas interactivo + A como export fiel**. Decisión abierta en `SPEC-puml-viewer.md`.
- **Parse Java:** sidecar `proyect-parser-core.jar` (+ `javaparser-core.jar`) invocado desde Electron main con `child_process.spawn('java', [...])`; bridge headless `AutoUmlBridge` (a crear en repo `ProyectParser`) con salida `.puml` + resumen JSON por stdout. Re-parse incremental con debounce + `chokidar`/`fs.watch`.
- **Persistencia:** `electron-store` (prefs + historial) y FS nativo para `.puml`; SQLite opcional si historial requiere búsqueda.
- **Calidad:** ESLint + Prettier, Vitest + Testing Library + Playwright (e2e Electron), cspell-ES si aplica.

## Commands

```bash
npm run dev          # electron-vite dev (renderer + main)
npm run build        # typecheck + build renderer + main + preload
npm run dist         # electron-builder --publish never (artefactos por OS)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint . --max-warnings=0
npm run lint:fix     # eslint . --fix
npm run format       # prettier --write .
npm test             # vitest run --coverage
npm run test:watch   # vitest
npm run e2e          # playwright test (smoke abrir proyecto, cargar puml, dnd)
```

## Project Structure

```text
apps/desktop/            → Main + preload + ventana Electron
resources/parser/        → Sidecar: proyect-parser-core.jar + javaparser-core.jar (+ bridge headless)
src/                     → Renderer React
src/components/          → Componentes React (Palette, Canvas, HistoryPanel, Toolbar)
src/lib/                 → Utilidades puras (puml-model, puml-serialize, graph-layout)
src/stores/              → Zustand stores (projectStore, diagramStore, historyStore)
src/workers/             → Workers (java-parse.worker, puml-render.worker)
tests/                   → Vitest unit/integration (por módulo)
e2e/                     → Playwright Electron
specs/                   → SPEC-<module>.md por módulo
resources/               → Iconos, plantuml.jar (si aplica)
docs/                    → ADRs, manuales
SPEC.md                  → Este archivo (visión global)
CAPABILITY-MAP.md        → Mapa de módulos y orden de construcción
```

## Code Style

TypeScript estricto, componentes funcionales, CSS modules o Tailwind (a decidir, uno solo). Ejemplo del estilo esperado:

```ts
// src/lib/puml-serialize.ts — puro, testeable, sin dependencias de UI
export interface UmlEntity { id: string; kind: 'class' | 'interface' | 'enum'; name: string; }
export function serializeToPuml(entities: UmlEntity[]): string {
  const header = '@startuml\nskinparam linetype ortho\n';
  const body = entities.map((e) => `${e.kind} "${e.name}" as ${e.id}`).join('\n');
  return `${header}${body}\n@enduml\n`;
}
```

Convenciones: nombres `PascalCase` componentes, `camelCase` funciones, `kebab-case` ids de módulo/ specs; errores tipados; sin `any` sin justificación; IPC via `preload` con `contextBridge` + validación `zod`.

## Testing Strategy

- **Framework:** Vitest (unit/integration) + Testing Library (componentes) + Playwright (e2e Electron).
- **Ubicación:** `tests/<module>/`, `src/**/*.test.ts(x)`; e2e en `e2e/`.
- **Cobertura:** ≥ 80% en `src/lib` (parse/serialización/layout); 100% caminos críticos (generar puml, cargar puml, historial).
- **Niveles:** unit (serializador, parser, stores) → integration (abrir proyecto → puml → render) → e2e (smoke: abrir carpeta Java fixture, cargar `.puml`, dnd una entidad, reabrir desde historial) → perf (fixture sintética 500/1000 entidades: FPS, TTI, memoria).
- **Fixtures:** proyecto Java de ejemplo (`tests/fixtures/sample-java/`) y `.puml` de 10/100/500/1000 entidades generados por script.

## Boundaries

- Always: correr `typecheck + lint + tests` antes de commit; IPC tipado y validado; no bloquear renderer (parse/render en worker/main); serializar `.puml` determinista.
- Ask first: añadir dependencias nativas (better-sqlite3), cambiar estrategia de render (PlantUML JAR vs grafo propio), empaquetar JRE, **cambiar la API del bridge headless / versión del sidecar `proyect-parser-core.jar`**, telemetría, cambios de esquema del modelo intermedio.
- Never: commitear secretos/firmas, editar `node_modules`/artefactos `dist/`, requerir red para funcionalidad core, borrar tests fallidos sin aprobación, exfiltrar código del proyecto Java del usuario.

## Success Criteria

- [ ] Abrir carpeta Java (≥ 50 clases reales) → `.puml` generado y renderizado, TTI < 5 s en laptop media.
- [ ] Edición en `.java` o en modelo → re-render < 500 ms (debounced) para < 100 entidades; sin freeze para 500+.
- [ ] Cargar `.puml` externo válido → se visualiza; inválido → error legible con línea.
- [ ] Historial: últimos N proyectos, reapertura en 1 clic, pin/eliminar/limpiar, persiste tras reinicio.
- [ ] Drag & drop: arrastrar desde paleta crea entidad/conexión y actualiza `.puml`; mover en canvas persiste posición/layout.
- [ ] 500 entidades: pan/zoom a ≥ 30 FPS, memoria < 1 GB, sin bloqueo > 200 ms por frame (medido en fixture sintética).
- [ ] Empaquetado `npm run dist` genera instalables Win/Linux (+mac si hay runner) que arrancan offline.

## Open Questions

1. ¿Versiones Java a soportar (8/11/17/21+) y sintaxis mínima (records, sealed)?
2. ¿Render fiel PlantUML (JAR + JRE) obligatorio o basta grafo propio + export `.puml`?
3. ¿Edición textual del `.puml` dentro de la app o solo vista + edición visual?
4. ¿Persistir layout/posiciones dentro del `.puml` (comentarios `!`) o en sidecar `.autouml.json`?
5. ¿Límite exacto del historial y datos a guardar (ruta, fecha, thumbnail)?
6. ¿Tailwind vs CSS modules y i18n (solo español o es/en)?
