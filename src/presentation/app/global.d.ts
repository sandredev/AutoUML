/// <reference types="vite/client" />
import type { AutoUmlApi } from '../../application/ports/ipc';

declare global {
  interface Window {
    autouml: AutoUmlApi;
  }
}

export {};
