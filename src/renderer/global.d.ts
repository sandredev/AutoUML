/// <reference types="vite/client" />
import type { AutoUmlApi } from '../shared/ipc';

declare global {
  interface Window {
    autouml: AutoUmlApi;
  }
}

export {};
