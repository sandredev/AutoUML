import { defineConfig } from 'vite';

// Vite solo construye el renderer. Main y preload los compila tsc (tsconfig.node.json).
// Se usa el JSX automático de esbuild en lugar de @vitejs/plugin-react porque ese plugin
// inyecta un script inline en desarrollo, y la CSP lo bloquearía.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  // El bundle clásico evita la carga de module workers desde file:// en Electron.
  worker: { format: 'iife' },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'chrome120',
  },
});
