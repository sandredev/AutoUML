// src/presentation/app/openGuard.ts — abrir otro documento con cambios del editor sin guardar (puro, sin React).
// Abrir pasa por `request`: sin cambios abre en el acto; con cambios guarda la acción y pide confirmación
// (el mismo modal que el cierre de la app). La respuesta del modal llega por `resolve`.

export type OpenChoice = 'save' | 'discard' | 'cancel';

export interface OpenGuardDeps {
  isDirty: () => boolean;
  /** Escribe el texto del editor en el .puml abierto; false si falló. */
  save: () => Promise<boolean>;
  /** Hay que preguntar (mostrar el modal). */
  onPrompt: () => void;
  /** La pregunta terminó: se abrió o se canceló (ocultar el modal). No se llama si Guardar falla. */
  onSettled: () => void;
}

export interface OpenGuard {
  request(open: () => void): void;
  /** true si se ejecutó la apertura pendiente. */
  resolve(choice: OpenChoice): Promise<boolean>;
  pending(): boolean;
}

export function createOpenGuard(deps: OpenGuardDeps): OpenGuard {
  let pending: (() => void) | null = null;
  return {
    request(open) {
      if (!deps.isDirty()) {
        open();
        return;
      }
      // Una segunda petición mientras se pregunta sustituye a la primera (el modal ya está abierto).
      const asking = pending !== null;
      pending = open;
      if (!asking) deps.onPrompt();
    },
    async resolve(choice) {
      const open = pending;
      if (open === null) return false;
      if (choice === 'cancel') {
        pending = null;
        deps.onSettled();
        return false;
      }
      // Si Guardar falla la petición sigue pendiente: el modal muestra el error y se puede reintentar.
      if (choice === 'save' && !(await deps.save())) return false;
      if (pending !== open) return false; // otra petición la sustituyó mientras se guardaba
      pending = null;
      deps.onSettled();
      open();
      return true;
    },
    pending: () => pending !== null,
  };
}
