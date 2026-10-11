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

## Layout estable y animación (T6)

### Layout estable entre recálculos
- Al recargar el mismo documento o plegar/desplegar un paquete, las tarjetas que ya existían se quedan donde estaban:
  `useDiagramLayout` pasa a `useLayout` las posiciones del layout mostrado (`hints`) **solo si las opciones no cambiaron**
  (`rankSep`, `nodeSep`, `summary`, `linetype`, display y `layoutVersion` forman la `reqKey`). "Restablecer" sube `layoutVersion`
  y recalcula desde cero.
- ELK pasa a modo interactivo (`layering`, `cycleBreaking` y `nodePlacement` = `INTERACTIVE`, `semiInteractive`, sin
  `separateConnectedComponents`). Solo se activa si sobrevive ≥ 50 % de las tarjetas y hay ≥ 3; si ELK fallara con pistas se
  reintenta sin ellas antes de caer a dagre.
- Las tarjetas nuevas se siembran en la capa contigua a sus vecinas, en un hueco libre de la fila y dentro del rango de su paquete
  (`completeHints`). Después, `anchorToHints` devuelve cada capa a su posición anterior y traslada el conjunto.
- **ELK ignora las pistas dentro de un grafo compuesto** (`INCLUDE_CHILDREN`). Por eso con paquetes el primer layout sigue siendo
  jerárquico y los recálculos con pistas son planos; las cajas de paquete se derivan de sus miembros (+ padding de ELK), **después**
  del anclaje. Dentro de un paquete ELK separa 20 px (no `rankSep`/`nodeSep`); el modo plano usa lo mismo (`PACKAGED_GAP`).
- **`postCompaction` es `NONE` en todos los layouts.** `EDGE_LENGTH` desplaza nodos a lo largo del eje de capas y un layout
  compactado no sirve de pista (76 % de tarjetas movidas al añadir una clase, frente a ~0 %). Coste medido: ≈ 3 % de área y de
  longitud de aristas.
- Medido con 25 diagramas de 30 clases al añadir una hoja: plano 0 %, con paquetes 1–8 % de media (peor caso 27 %); sin pistas ≈ 85 %.
- dagre (respaldo, > 150 nodos al principio) no respeta posiciones: solo ancla el conjunto.

### Animación (`tween.ts`, `DiagramCanvas`)
- Una transición de layout (recarga, plegar, Restablecer, refinado dagre→ELK) solo se anima dentro del mismo documento. No se anima el
  primer layout, un documento distinto, los overrides iniciales del sidecar, el arrastre de una tarjeta, ni más de 400 tarjetas.
- Tarjetas que se mueven: `ease-in-out` (`0.77, 0, 0.175, 1`), 260 ms; su tamaño salta al final. Entran con opacidad y escala
  0.95 → 1 (`ease-out` `0.23, 1, 0.32, 1`, con un retardo del 20 %); salen en el 60 % del tiempo. Interrumpible: la siguiente
  transición parte del fotograma que se ve.
- `fit()` y `focusNode()` vuelan la cámara (280 ms) por defecto; `{ animate: false }` para atajos de teclado (Ctrl+0 lo usa).
  Cualquier gesto del usuario cancela el vuelo.
- Con `prefers-reduced-motion`: sin desplazamiento, escala ni vuelo de cámara; se conservan los fundidos (160 ms) y el halo.
- Halo de 2 s sobre las tarjetas nuevas o con contenido modificado al recargar el mismo documento (`changedTypes`, que ignora la
  línea del `.puml`).

## Editor en vivo (T7)

### Panel
- CodeMirror 6 (`@codemirror/*`, `@lezer/highlight`) en `presentation/editor/`, cargado en un chunk aparte (`React.lazy`): el
  bundle principal no crece (~390 kB; el editor son ~340 kB que solo se piden con un documento abierto).
- Resaltado con un `StreamLanguage` propio (`pumlLanguage.ts`) que reutiliza las regex del parser (`PUML_SYNTAX`). Números de
  línea, los `ParseIssue` como diagnósticos (subrayado + tooltip) y colores por variables CSS del tema.
- Ver → Editor de código / Ctrl+E (Exportar PNG queda sin atajo). Ancho ajustable arrastrando el borde; doble clic lo restablece.
  Oculto sigue montado: conserva texto, cursor e historial de deshacer.
- Conserva el fin de línea del archivo (CRLF o LF) aunque se pegue texto con el otro.

### Código → diagrama
- Debounce de 250 ms; con `!include` main combina el texto del editor con los incluidos del disco (`puml:combine-source`).
- Con errores graves (`severity: 'error'`) se mantiene el último diagrama válido (`nextLiveState`) y el panel de issues muestra
  los errores nuevos. El diagrama se actualiza con el layout estable y la animación de T6; el halo ignora `line`/`endLine`.

### Diagrama → código
- `TypeNode.endLine`: rango `[line, endLine]` de cada tipo (`}` de cierre, o la propia línea).
- `createSourceIndex` (línea → tipo/relación y tipo → rango) y `lineMapping` (líneas del archivo ↔ texto combinado).
- Clic en una tarjeta (o en la sidebar) → el editor salta a la declaración y la resalta 1,6 s. Clic en una arista → su línea.
- Cursor del editor en un tipo → se selecciona la tarjeta; en una relación → se resalta su arista (`highlightLine`).
- Clic en un issue → abre el editor en su línea (los de un archivo incluido no saltan).

### Guardar y cierre
- Ctrl+S (menú Archivo → Guardar o el botón del panel) escribe el `.puml` abierto sin diálogos (`puml:save-source`: proyecto →
  `diagram.puml`; archivo externo → escritura atómica). Exige `@startuml`/`@enduml`.
- "Sin guardar" en el panel y en el modal de cierre: Guardar escribe el `.puml` y cierra; si falla, la app sigue abierta.
- Si el archivo cambia en disco con cambios sin guardar, no se pisan (aviso); sin cambios, el editor toma el texto del disco.

### Renombrar desde el lienzo
- Doble clic en una tarjeta → campo en línea. Reescribe el identificador y sus referencias (relaciones, tipos de miembros, notas,
  `hide`, `A::campo`, `paquete.A`) usando el tokenizador; no toca comentarios, notas, etiquetas, nombres de campo ni `OrderItem`.
  Es una sola transacción del editor: Ctrl+Z la deshace.
- No se ofrece con alias/genéricos (`name !== id`) ni si el documento usa `!include`.
