# SPEC-puml-io-history: Cargar .puml + historial

> Módulo: `puml-io-history` · Depende de: `app-shell`.

## Contrato TypeScript

La interfaz exacta para el servicio y el bridge está en `src/shared/history.ts` (`HistoryEntry`, `HistoryApi` y `HistoryStore`). Ese archivo define la forma de las entradas, resultados de apertura y operaciones; los specs funcionales de este documento siguen siendo la autoridad del comportamiento.

## Objective

Abrir/guardar `.puml` existentes (drag de archivo al app incluido), validar y llevarlos al viewer; mantener **historial de proyectos abiertos** (carpeta Java o `.puml`) con reapertura en 1 clic, pin, eliminar y limpiar.

Historias: como estudiante retomo mi último proyecto sin buscar la ruta; como docente cargo el `.puml` de un ejemplo para mostrarlo.

## Tech Stack

FS vía IPC (`fs:openPuml`, `fs:savePuml`), `electron-store` (`autou ml.history[]: {id, kind, path, name, lastOpenedAt, pinned, thumbnail?}`), parser `.puml` tolerante (subset clases) compartido con viewer.

## Commands

```bash
npm test -- tests/puml-io-history
```

## Project Structure

```text
src/lib/puml-parse.ts   → .puml (subset) → UmlModel parcial
src/stores/historyStore.ts → CRUD historial + persistencia
src/components/HistoryPanel.tsx → lista, búsqueda, pin/delete/clear
tests/puml-io-history/  → round-trip model→puml→model, historial persiste
```

## Code Style

Parse nunca lanza sin contexto: retorna `{ model, errors: {line, message}[] }`. Historial máx 30, orden `pinned → recencia`, rutas normalizadas, inexistentes marcadas no eliminadas solas.

## Testing Strategy

Vitest: round-trip 20 fixtures `.puml` (incl. inválidos con error de línea); historial: agregar/reabrir/pin/limpiar + persistencia mockeada. E2E: cargar `.puml` → se renderiza; reiniciar → historial intacto.

## Boundaries

- Always: validar tamaño (< 5 MB o advertir), errores con línea legible, no duplicar entradas (upsert por path normalizado).
- Ask first: thumbnails, búsqueda full-text, sync cloud.
- Never: borrar archivos del usuario desde historial (solo desvincula), telemetría de rutas.

## Success Criteria

- [ ] `.puml` válido → render; inválido → mensaje con línea, sin crash.
- [ ] Guardar genera `.puml` que PlantUML oficial acepta.
- [ ] Historial persiste tras reinicio; reapertura 1 clic < 1 s (sin re-parse si hay caché válida).
- [ ] Drop de `.puml` sobre la ventana lo abre.

## Open Questions

1. ¿Límite N del historial (20/30/50) y guardar thumbnail?
2. ¿Sidecar `.autouml.json` para layout (ver Q4 global)?
