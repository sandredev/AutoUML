# AutoUML

Aplicación de escritorio para abrir, inspeccionar y exportar diagramas de clases PlantUML. Incluye creación y carga de proyectos, historial de archivos recientes y registro de carpetas Java para una futura integración del análisis.

## Funcionalidades

- Crear y cargar proyectos AutoUML. Cada proyecto mantiene como máximo un diagrama en `diagram.puml`.
- Abrir archivos `.puml` desde el historial o arrastrarlos a la aplicación; guardar el diagrama actual con otro nombre.
- Navegar clases, interfaces, enums, records, anotaciones, tipos `sealed`, externos y no declarados.
- Buscar y seleccionar tipos, plegar paquetes, recorrer diagramas grandes con minimapa y controles de zoom, y exportar el canvas a PNG.
- Registrar una carpeta Java en el historial. El análisis del código Java todavía no está integrado.

## Requisitos

- Node.js 20.19+ o 22.12+ y npm ([descargar Node.js](https://nodejs.org/)).
- Git para clonar el repositorio.
- Conexión a internet durante `npm ci`, porque Electron se descarga como dependencia.
- La integración futura de análisis Java requerirá JRE 17 o posterior.

## Compilar en Windows

1. Instala Node.js y Git.
2. Abre PowerShell en la carpeta del proyecto.
3. Instala las dependencias:

```bash
npm ci
```

4. Para ejecutar la aplicación en desarrollo:

```bash
npm run dev
```

5. Para revisar y compilar el proyecto:

```bash
npm run typecheck
npm test
npm run build
```

6. Para crear el ejecutable portable de Windows:

```bash
npm run dist
```

El archivo `.exe` se genera en `release/`, con un nombre como `AutoUML-0.1.0-win-x64.exe`. Abre ese archivo para ejecutar la versión portable. `npm run dist` compila para el sistema operativo donde se ejecuta.

## Compilar en Linux

1. Instala Node.js y Git desde el gestor de paquetes de tu distribución o desde [nodejs.org](https://nodejs.org/).
2. Abre una terminal en la carpeta del proyecto e instala las dependencias:

```bash
npm ci
```

3. Para ejecutar la aplicación en desarrollo:

```bash
npm run dev
```

4. Para revisar y compilar el proyecto:

```bash
npm run typecheck
npm test
npm run build
```

5. Para crear el paquete Linux:

```bash
npm run dist
```

El AppImage queda en `release/`, con un nombre como `AutoUML-0.1.0-linux-x86_64.AppImage`. Dale permiso de ejecución y ábrelo:

```bash
chmod +x release/AutoUML-0.1.0-linux-x86_64.AppImage
./release/AutoUML-0.1.0-linux-x86_64.AppImage
```

El AppImage necesita la biblioteca FUSE 2 para ejecutarse. En Ubuntu/Debian instala `libfuse2` (en Ubuntu 24.04, `libfuse2t64`); en Arch Linux, instala `fuse2`. Si no puedes habilitar FUSE, prueba `./release/AutoUML-0.1.0-linux-x86_64.AppImage --appimage-extract-and-run`.

Para generar el `.exe` de Windows desde Linux, configura Wine y ejecuta:

```bash
npx electron-builder --win portable --x64 --publish never
```

El empaquetado de Windows suele ser más sencillo al ejecutar `npm run dist` en Windows.

Los paquetes usan ASAR; Vite genera el worker de layout como bundle clásico para el renderer empaquetado.

## Estructura del proyecto

El código sigue Clean Architecture: las dependencias apuntan siempre hacia adentro
(`presentation` / `infrastructure` → `application` → `domain`). `tests/architecture/layers.test.ts`
lo verifica automáticamente.

```text
src/
  domain/          Modelo UML y reglas puras (sin Electron, DOM ni fs)
    diagram/       model, classify, skinparam
    rules/         validation (nombres, extensiones .puml), themes
  application/     Casos de uso puros y contratos
    puml/          parser, include, validate (texto .puml → DiagramModel)
    ports/         ipc, history: contrato entre la UI y el proceso principal
  infrastructure/  Electron y Node
    main/          arranque, menú, cierre, handlers IPC
    preload/       puente seguro (window.autouml)
    storage/       proyectos, historial, sidecar
    filesystem/    lectura de .puml con includes, watcher
  presentation/    Interfaz React
    app/           App, main, index.html, estilos
    components/    paneles, diálogos, iconos
    diagram/       motor del visor: layout (dagre/ELK), canvas, SVG
    localization/  textos es/en y selección de idioma (internacionalización)
tests/             espejo de src/ por capa, más fixtures/ y helpers/
public/            archivos estáticos que Vite copia tal cual (favicon)
```

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
