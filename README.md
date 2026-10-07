# AutoUML

Aplicación de escritorio para abrir, inspeccionar y exportar diagramas de clases PlantUML. Incluye creación y carga de proyectos, historial de archivos recientes y registro de carpetas Java para una futura integración del análisis.

## Funcionalidades

- Crear y cargar proyectos AutoUML. Cada proyecto mantiene como máximo un diagrama en `diagram.puml`.
- Abrir archivos `.puml` desde el historial o arrastrarlos a la aplicación; guardar el diagrama actual con otro nombre.
- Navegar clases, interfaces, enums, records, anotaciones, tipos `sealed`, externos y no declarados.
- Buscar y seleccionar tipos, plegar paquetes, recorrer diagramas grandes con minimapa y controles de zoom, y exportar el canvas a PNG.
- Registrar una carpeta Java en el historial. El análisis del código Java todavía no está integrado.

## Requisitos

- Node.js compatible con Vite 7 y npm.
- Para ejecutar la aplicación en desarrollo o empaquetarla se requiere el binario de Electron, que npm instala como dependencia.
- La integración futura de análisis Java requerirá JRE 17 o posterior.

## Desarrollo y compilación

```bash
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm run dist
```

`npm run dist` genera el ejecutable portable de Windows y el AppImage de Linux en `release/`. Los archivos de aplicación se empaquetan en ASAR; Vite genera el worker de layout como bundle clásico para el renderer empaquetado.

## Almacenamiento de proyectos

En desarrollo, los proyectos se guardan dentro de la carpeta `userData` de Electron. En una aplicación empaquetada, AutoUML intenta crear `projects/` junto al ejecutable (o junto al AppImage). Si no puede escribir allí, usa `userData/projects` y presenta un aviso. Cada proyecto contiene `project.json` y, si tiene diagrama, `diagram.puml`.

## Formato PlantUML

El visor reconoce declaraciones de clases, interfaces, enums, records y anotaciones, estereotipos como `<<sealed>>`, miembros, paquetes, alias y relaciones de herencia, implementación, asociación y dependencia. Las construcciones fuera de este subconjunto pueden ignorarse o mostrarse como avisos. AutoUML no ejecuta PlantUML ni necesita conexión a internet para dibujar.

## Especificaciones

- [Visión global](SPEC.md)
- [Mapa de capacidades](CAPABILITY-MAP.md)
- [Shell de la aplicación](specs/SPEC-app-shell.md)
- [Ingesta Java](specs/SPEC-java-ingest.md)
- [Historial y entrada PUML](specs/SPEC-puml-io-history.md)
- [Visor PUML](specs/SPEC-puml-viewer.md)
- [Interacción con el canvas](specs/SPEC-canvas-interaction.md)
