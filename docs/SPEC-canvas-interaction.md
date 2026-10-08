# SPEC-canvas-interaction: Menú drag & drop sobre entidades

> Módulo: `canvas-interaction` · Depende de: `puml-viewer` (opera sobre su grafo/selección).

## Objective

**Paleta/menú drag & drop** para interactuar con las entidades: arrastrar crea clase/interfaz/enum/relación, mover reposiciona, clic selecciona y edita (nombre, miembros, visibilidad), suprimir elimina (con confirmación). Todo cambio actualiza el modelo y **regenera el `.puml`** (o lo marca pendiente de re-generar vía sidecar si afecta al código).

Historias: como estudiante arrastro una clase al lienzo y el `.puml` se actualiza; como docente reordeno entidades en vivo durante la clase.

## Tech Stack

React DnD (dnd-kit o react-dnd, uno solo) + estado en `diagramStore` (acciones undo/redo). Edición visual sobre el grafo del viewer; la verdad del `.puml` generado desde Java la posee el sidecar: los cambios visuales viven en **capa overlay** (`overlay: added/moved/edited/hidden`) que se fusiona al serializar, sin reescribir fuentes `.java` en v1.

## Commands

```bash
npm test -- tests/canvas-interaction
npm run e2e  # dnd crea entidad, mover persiste, undo revierte
```

## Project Structure

```text
src/components/Palette.tsx       → paleta arrastrable (clase, interfaz, enum, herencia, asociación, nota)
src/components/DiagramCanvas.tsx → drop-target, mover, seleção (extiende viewer)
src/components/EntityEditor.tsx   → inspector lateral (nombre, miembros, visibilidad)
src/stores/diagramStore.ts       → overlay + undo/redo + serialización
src/lib/puml-serialize.ts        → overlay + modelo base → .puml (si edición local; si no, marca dirty)
tests/canvas-interaction/
```

## Code Style

Acciones como comandos reversibles (`addEntity`, `moveEntity`, `connect`, `editEntity`, `removeEntity`) con inversa registrada; nada de mutación directa del grafo. Serialización determinista (mismo orden que el sidecar).

## Testing Strategy

Vitest: cada comando (hacer/deshacer/rehacer), serialización con overlay, conflictos (entidad editada que desaparece tras re-parse → se conserva como overlay huérfano visible). Testing Library: dnd vía teclado (accesibilidad) + mouse. E2E: dnd→entidad visible→`.puml` actualizado→undo revierte. Cobertura ≥ 80% en comandos/serialización.

## Boundaries

- Always: undo/redo (≥ 50 pasos), confirmación al eliminar, accesible por teclado, overlay nunca destruye datos del re-parse.
- Ask first: edición que reescriba `.java` fuentes (round-trip código), edición textual libre del `.puml`.
- Never: inventar relaciones no presentes en el modelo (toda arista tiene origen: sidecar o gesto explícito del usuario).

## Success Criteria

- [ ] Arrastrar desde paleta crea entidad/conexión y el `.puml` se actualiza (o queda `dirty` con indicador si requiere re-parse).
- [ ] Mover persiste posición tras re-render y reinicio (overlay/sidecar según Q global).
- [ ] Undo/redo revierte cada gesto; eliminar pide confirmación.
- [ ] Con 500 entidades, crear/mover no baja de 30 FPS ni pierde selección.

## Open Questions

1. ¿Los cambios visuales deben reescribir los `.java` (round-trip) o vivir solo en overlay + `.puml`?
2. ¿Veto/creación manual de relaciones (como la revisión de `AppGenerador` Fase 5) en v1?
