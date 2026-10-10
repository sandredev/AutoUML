# Contexto del rol (actualizar tras cada tarea)

## Rol
Agente de código del proyecto AutoUML (Electron + React + TypeScript): implemento el
roadmap por tandas (T1–T11) usando las skills disponibles, con TypeScript estricto,
comentarios en español, módulos puros en `src/core` y `src/render/layout`, test Vitest
por arreglo, i18n en el renderer y `npm test && npm run typecheck && npm run build`
en verde por tanda.

## Reglas fijas
- Ningún `.md` sube al repo, salvo `CONTEXTO.md` (forzado en `.gitignore`).
- Cada etapa (T2–T11) se trabaja en su rama `feature/tN` con base en `develop`.

## Skills cargadas
- `plantuml` en `.claude/skills/plantuml`
- `test-driven-development` en `.claude/skills/test-driven-development`
- `systematic-debugging` en `.agents/skills/systematic-debugging`

## Última tarea hecha
- 2026-10-10 — T3 Rendimiento y dirección ejecutada en rama `feature/t3` (commiteada, PR a `develop` pendiente):
  `elkLayout.ts` (layeringOf/hint, ELK_FAST_NODES, sin timeout dentro), `layout.worker.ts`
  (motor por petición), `useLayout.ts` (timeout real con terminate + progresivo dagre→ELK),
  barra motor/ms en `PumlViewer`, fit/overrides por `layoutModel` en `DiagramCanvas`,
  `bench-layout.ts` (50: 25/189 ms, 200: 42/432 ms, 500: 165/1432 ms dagre/ELK),
  tests: layeringOf + direction LR en ambos motores. Verificado: 126/126 tests,
  typecheck limpio, build verde.
- 2026-10-10 — T2 fusionada en `develop` (merge `a097812`, push a origin) y rama
  `feature/t3` creada sobre `develop`. Verificado en `develop`: 120/120 tests,
  typecheck limpio.
- 2026-10-10 — T2 tests mínimos (2 nuevos): `edgePath.test.ts` (firstSegment) y
  bucle ELK en `elkLayout.test.ts` (ortogonal, rel/self). Verificado: typecheck
  limpio, 120/120 tests, build verde.
- 2026-10-10 — T2 Dibujo y medida commiteada en rama `feature/t2`:
  `types.ts` (EdgePath rel/self), `selfLoop.ts` nuevo, `fmtParams` única en
  `cardModel.ts`, `members.ts` borrado, `layout.ts` dagre con direction y medida
  única, `edgePath.ts` (firstSegment/heads/trimEnds), `color.ts`/`card.ts`/
  `edgeDraw.ts` nuevos, `draw.ts` delegado, `elkLayout.ts` con direction y bucles.
  Verificado: typecheck limpio, 118/118 tests, build verde.
- 2026-10-10 — T1 Parser y modelo commiteada en `develop` (rama `feature/t2`
  creada sobre `develop` para la siguiente etapa). Verificado: typecheck limpio,
  118/118 tests, build verde.
- 2026-10-10 — Diagnóstico de `E:\proyeto.puml`: es un diagrama de secuencia
  (`actor/participant/activate/alt…`), fuera del alcance de AutoUML (solo clases).
  Reproducido con el parser (0 tipos, 0 relaciones, mismos warnings del usuario).
  Sin cambios de código.
- 2026-10-10 — Icono de ventana Electron ausente: la copia de `build/icon.png`
  faltaba en disco; restaurada (bytes idénticos a git, ya estaba commiteada).
- 2026-10-10 — T1 Parser y modelo (bloque 2 final): `model.ts`, `parser.ts`
  reescrito y tests T1 en `parser.test.ts`.

## Tareas pendientes (reparto final: EJECUTO yo en el repo; DISEÑA el otro modelo y me pasa diffs)
- [x] [EJECUTO] T2 Dibujo y medida de tarjetas (`src/render`) — FUSIONADA en `develop` (merge `a097812`, 120/120 tests, build verde).
  Cabezas por extremo (sourceHead/targetHead) + `firstSegment`; multiplicidades y
  etiqueta central con fondo; bucles self-relación en ELK; unificar medida con
  `makeMeasurer()` + `FONTS` y deduplicar (`memberRows`, `fmtParams`, `iconFor` vs
  `badgeOf`); colores por clase; anidamiento `+--` y estilos de arista.
  Skills: `plantuml`, `systematic-debugging`.
- [ ] [EJECUTO] T3 Rendimiento y dirección del layout (retenida: bug sutil, la hago yo) — EJECUTADA en rama `feature/t3` (commiteada, PR a `develop` pendiente).
  Timeout real con `worker.terminate()` desde el hilo principal (ELK bloquea el Worker,
  el timeout NO puede vivir dentro); layout progresivo (dagre rápido primero, ELK
  después); `direction` TB/LR en ambos motores; `hint` por arista; barra con motor
  usado y ms. Benchmark con `scripts/gen-puml.ts` (50/200/500 clases, primer layout
  visible < 1 s con 500). Skills: `systematic-debugging`.
- [ ] [EJECUTO] T4 Calidad visual del canvas (notas amarillas en layout, paquetes plegados con
  relayout, hover/selección con atenuado, hit-test de aristas, minimapa interactivo,
  hide/show/remove, skinparam básico, i18n vía `labels`). Skills: `web-design-guidelines`.
- [ ] [EJECUTO] T5 Persistencia, recarga y exportación (`fs.watch` + debounce, conservar vista al
  recargar, `layout.json`/sidecar, `!include` con ciclos, export SVG/PDF/PNG, menú + i18n).
  Skill: `electron`.
- [ ] [DISEÑA] T6 Layout estable + transiciones animadas (diseño del otro modelo). ELK
  `considerModelOrder` + posiciones previas; `tween.ts` (~300 ms, ease-out,
  `prefers-reduced-motion`); fly-to en `fit()`/`focusNode()`; halo 2 s en cambiadas.
  Skills: `emil-design-eng`.
- [ ] [DISEÑA] T7 Editor en vivo (diseño del otro modelo, yo cableo/testeo). CodeMirror 6 con
  resaltado PlantUML, diagnósticos de `ParseIssue`, debounce 250 ms, sync código↔canvas
  por `line`, Ctrl+S integrado con `closeFlow`. Dependencia `@codemirror/*` APROBADA
  por el usuario desde 2026-10-10.
- [ ] [EJECUTO] T8 Modo foco, ruta entre clases y filtros. Vecindario a N saltos, BFS dirigido,
  filtros semánticos (DetailOptions), menú contextual. Lógica pura en `src/render/graph/`.
  Skill: `graph-algorithms`.
- [ ] [EJECUTO] T9 Diagnóstico de arquitectura. Tarjan (ciclos), violaciones de capas, mapa de calor
  fan-in/fan-out/inestabilidad, panel de métricas, export Markdown. Puros en
  `src/core/analysis/`. Skill: `coupling-analysis`.
- [ ] [EJECUTO] T10 Diff visual entre versiones. `src/core/diff.ts` semántico (añadidos/eliminados/
  modificados por id), vista unificada verde/rojo/ámbar, navegación N/P, export.
  Skill: `test-driven-development`.
- [ ] [MIXTA] T11 Paleta de comandos, presentación y zoom semántico (paleta y vistas las
  ejecuto yo; zoom semántico lo DISEÑA el otro modelo).
  Ctrl+K difusa accesible, vistas guardadas en `layout.json`, agregación por paquetes
  bajo `LOD_BOXES`, atajos de teclado y ayuda `?`. Skills: `web-design-guidelines`.
- [ ] Menor: generar `build/icon.ico` / `build/icon.icns` para empaquetado Windows/macOS
- [ ] Fuera de roadmap (solo si se pide): soporte de diagramas de secuencia

## Orden de ejecución (en serie, nunca en paralelo: varias tandas tocan los mismos archivos)
- `elkLayout.ts`: T2, T3 y T6. `DiagramCanvas.tsx`: T4, T5 y T6. `App.tsx`: T5 y T7.
  `draw.ts`: T2, T4 y T11.
- Seguir dependencias del roadmap: T2 → T4; T3 → T5 → T6 → T7; T8 → T9 y T11; T6 → T10.

## Contrato T1 para los diseños del otro modelo (verificado contra `src/core/`)
- `direction`: el parser siempre lo rellena (`'TB'` por defecto, `'LR'` con la directiva).
- `hint`: normalizado a source→target (se invierte si la flecha se invirtió).
- `labelArrow`: `'forward'` o `'backward'` (nunca `<`/`>`).
- `HeadType`: `none | open | triangle | diamond | diamond-filled | cross | circle | plus | square`
  (`circle` existe en el tipo pero el parser nunca lo emite; `o` da `diamond`).
- `notes[].anchor`: un solo id (o ausente); `note over A, B` ancla solo A sin `position`.
