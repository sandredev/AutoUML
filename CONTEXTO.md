# Contexto del rol (actualizar tras cada tarea)

## Rol
Agente de código del proyecto AutoUML (Electron + React + TypeScript): implemento el
roadmap por tandas (T1–T11) usando las skills disponibles, con TypeScript estricto,
comentarios en español, módulos puros en `src/core` y `src/render/layout`, test Vitest
por arreglo, i18n en el renderer y `npm test && npm run typecheck && npm run build`
en verde por tanda.

## Skills cargadas
- `plantuml` en `.claude/skills/plantuml`
- `test-driven-development` en `.claude/skills/test-driven-development`
- `systematic-debugging` en `.agents/skills/systematic-debugging`

## Última tarea hecha
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

## Tareas pendientes
- [ ] T2 Dibujo y medida de tarjetas (`src/render`) — EN CURSO en rama `feature/t2`
- [ ] T3 Rendimiento y dirección del layout (diseño del otro modelo, yo ejecuto/verifico)
- [ ] T4 Calidad visual del canvas (notas, hover, minimapa, hide, skinparam)
- [ ] T5 Persistencia, recarga y exportación (fs.watch, layout.json, SVG/PDF)
- [ ] T6 Layout estable + transiciones animadas (diseño del otro modelo)
- [ ] T7 Editor en vivo (diseño del otro modelo, yo cableo/testeo)
- [ ] T8 Modo foco, ruta entre clases y filtros
- [ ] T9 Diagnóstico de arquitectura
- [ ] T10 Diff visual entre versiones
- [ ] T11 Paleta de comandos, presentación y zoom semántico (zoom: diseño del otro modelo)
- [ ] Menor: generar `build/icon.ico` / `build/icon.icns` para empaquetado Windows/macOS
- [ ] Fuera de roadmap (solo si se pide): soporte de diagramas de secuencia
