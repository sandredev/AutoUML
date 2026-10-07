# SPEC-puml-viewer: Render en tiempo real (500+ entidades)

> Módulo: `puml-viewer` · Depende de: `app-shell`, `java-ingest`, `puml-io-history`.

## Objective

Renderizar el `.puml` (generado por el sidecar o cargado desde archivo) **en tiempo real** y mantener la UI fluida con **500+ entidades**: pan/zoom, minimap, búsqueda, colapso por paquete, resaltado de relaciones y estados de carga/error legibles.

Historias: como estudiante edito mi código y veo el diagrama actualizarse sin congelamientos; como docente proyecto un diagrama de 500 clases y navego fluido.

## Tech Stack

A decidir en Plan entre: (A) render PlantUML local (JAR + Graphviz, SVG fiel al `.puml`) para fidelidad; (B) grafo propio (React Flow / Cytoscape.js + elkjs) parseando el subset de clases que emite la librería, para interacción y virtualización. Recomendación inicial: **B para canvas interactivo + A como export/vista fiel**. Render fuera del hilo UI (worker/service), debounce 300–500 ms, layout incremental y `viewport culling`.

## Commands

```bash
npm test -- tests/puml-viewer
npm run e2e  # smoke: cargar .puml 500 entidades, pan/zoom sin freeze
```

## Project Structure

```text
src/lib/puml-parse.ts      → subset .puml (clases) → grafo (solo si estrategia B)
src/lib/graph-layout.ts    → layout incremental (elkjs/dagre), puras y testeables
src/components/DiagramCanvas.tsx → canvas, viewport, minimap, overlays
src/stores/diagramStore.ts → pumlText, grafo, viewport, selección (compartido con interacción)
tests/puml-viewer/ + fixtures 10/100/500/1000 entidades (generados por script)
```

## Code Style

Canvas desacoplado del parser: recibe grafo/`pumlText`, emite selección/viewport. Sin lógica de negocio en componentes; layout y parse puros. Presupuesto de perf como constante documentada (`TARGET_FPS=30`, `FRAME_BUDGET_MS=200`).

## Testing Strategy

Vitest: parser del subset (round-trip con `.puml` reales de la librería, incluidos `@external`, homónimos con alias, `package` blocks), layout determinista. Perf: fixture 500/1000 entidades mide FPS, TTI y memoria (umbrales en Success Criteria; falla CI si regresa > 20%). E2E: cambio en fuente → re-render < 500 ms (< 100 nodos).

## Boundaries

- Always: debounce + cancelación de renders obsoletos; errores `.puml` con línea; no bloquear el hilo UI (> 200 ms → worker).
- Ask first: cambiar motor de render/layout, bajar fidelidad PlantUML por perf.
- Never: requerir red para render core; perder la selección/viewport en re-render incremental.

## Success Criteria

- [ ] < 100 entidades: re-render < 500 ms tras cambio (debounced).
- [ ] 500 entidades sintéticas: pan/zoom ≥ 30 FPS, memoria < 1 GB, sin frame > 200 ms.
- [ ] `.puml` inválido → error con línea, último diagrama válido visible.
- [ ] Búsqueda por nombre y colapso por paquete funcionan con 500+ nodos.

## Open Questions

1. ¿Fidelidad PlantUML exacta obligatoria (entonces A) o grafo propio aceptable (B)?
2. ¿Qué layout por defecto (ortho/elk) y persistencia de posiciones?
