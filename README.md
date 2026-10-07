# AutoUML

Aplicación de escritorio para visualizar diagramas de clases PlantUML y, en fases posteriores, generarlos desde proyectos Java y editarlos en un canvas.

## Estado

El código importado aporta el primer visor funcional: parser de un subconjunto de PlantUML, layout en Web Worker, canvas con pan/zoom, búsqueda y selección por categoría, colapso de paquetes, minimapa y exportación PNG con diálogo nativo. El componente de visualización está separado de Electron; la API pública para el shell de AutoUML se exporta desde `src/render/index.ts`.

El bridge `window.autouml` ya está tipado, pero conserva por ahora los métodos del flujo de proyectos PUML importado. La integración del sidecar Java y el historial compartido siguen pendientes según los specs.

## Requisitos y comandos

- Node.js compatible con Vite 7 y npm.
- Electron se descarga durante `npm ci`; la ejecución de la app requiere su binario.
- Para generar diagramas desde Java también se requerirá JRE 17+ cuando se integre `java-ingest`.

```bash
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm run dist
```

`npm run dist` empaqueta el ejecutable portable de Windows y AppImage de Linux. El worker de layout se genera como bundle clásico para cargarlo desde el renderer empaquetado.

## PlantUML

El visor reconoce declaraciones de clases, interfaces, enums, records, anotaciones y estereotipos, miembros, paquetes, alias y relaciones de herencia, implementación, asociación y dependencia. Las directivas y construcciones PlantUML fuera de ese subconjunto pueden ignorarse o aparecer como avisos; la app no ejecuta PlantUML ni necesita conexión a internet para dibujar.

## Especificaciones

- [Visión global](SPEC.md)
- [Mapa de capacidades](CAPABILITY-MAP.md)
- [Spec del visor](specs/SPEC-puml-viewer.md)
