# SPEC-app-shell: Shell Electron + React

> Módulo: `app-shell` · Depende de: — · Provee base a todos los demás.

## Objective

Ventana de escritorio rápida y segura: arranque < 2 s, IPC tipado, acceso FS (abrir carpeta/guardar), persistencia de preferencias, menús y empaquetado Win/Linux/mac.

Historias: como estudiante quiero abrir la app offline y retomar donde quedé; como docente quiero instalarla sin Node/Java previos.

## Tech Stack

Electron + electron-vite, React + TS strict, Zustand (prefs), electron-store (settings), electron-builder.

## Commands

```bash
npm run dev / npm run build / npm run dist
npm run typecheck && npm run lint && npm test
```

## Project Structure

```text
apps/desktop/main/      → main.ts, ipc-handlers.ts, fs-service.ts
apps/desktop/preload/   → preload.ts (contextBridge, API tipada)
src/stores/             → appStore (tema, última ruta, panel layout)
src/components/AppShell → TitleBar, Sidebar, StatusBar
```

## Code Style

Todo acceso Node solo en `main`; renderer solo vía `window.autouml.*` tipado + zod. Ejemplo:

```ts
// preload.ts
contextBridge.exposeInMainWorld('autouml', {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('fs:openFolder'),
});
```

## Testing Strategy

Vitest para stores/servicios puros; Playwright e2e smoke: arranca, abre ventana, `fs:openFolder` mockeado, prefs persisten. Cobertura ≥ 70% en shell.

## Boundaries

- Always: contextIsolation + sandbox, validar todo input IPC con zod.
- Ask first: auto-update, deep-linking, múltiples ventanas.
- Never: `nodeIntegration: true`, `remote`, exponer `fs` crudo al renderer.

## Success Criteria

- [ ] `npm run dev` levanta en < 10 s; app empaquetada arranca < 2 s offline.
- [ ] Abrir/guardar vía diálogo nativo funciona en Win + Linux.
- [ ] Ningún `any` en boundary IPC; `typecheck` verde.
- [ ] `npm run dist` produce instalables que arrancan sin Node instalado.

## Open Questions

1. ¿Auto-update (electron-updater) en v1 o instalación manual?
2. ¿Una sola ventana o multi-ventana por proyecto?

## Temas (apariencia)

- Registro único en `src/domain/rules/themes.ts` (`THEME_IDS`, `THEME_MODES`, `THEME_SCHEME`, `isThemeMode`). Main lo usa para validar `MenuState.themeMode` y construir el menú Configuración → Tema; el renderer, para Ajustes y `useTheme`.
- Modos: `system` (se resuelve a `light`/`dark` según el SO) + `light`, `dark`, `midnight`, `ember`, `sunrise`, `contrast`. Paleta derivada del icono: naranja `#FF5F3C`, azul noche `#1E2033`, amarillo `#F5D33B`.
- `useTheme` fija siempre `data-theme` con el tema ya resuelto y `color-scheme` según `THEME_SCHEME`. Los colores viven en `src/presentation/app/theme.css` (variables `--bg`, `--accent`, `--hover`, `--uml-*`, …); el lienzo del diagrama las lee por `getComputedStyle` y se repinta al cambiar `data-theme`.
- Añadir un tema = una entrada en `THEME_IDS` y `THEME_SCHEME`, un bloque en `theme.css`, `themeSwatches` (useTheme), claves `settings.theme*` en `catalog.ts` y etiqueta en `menu.ts`.
