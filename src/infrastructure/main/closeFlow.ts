// Flujo de confirmación de cierre (main). El renderer decide si hay un diagrama que proteger.
// Fases: idle -> awaitingAck (timeout 2 s) -> awaitingDecision (sin timeout) -> closing.
import { app, BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import type { CloseDecision, IpcChannel } from '../../application/ports/ipc';

const ackTimeoutMs = 2000;
const closeRequestedChannel: IpcChannel = 'app:close-requested';
const confirmCloseChannel: IpcChannel = 'app:confirm-close';

type Phase = 'idle' | 'awaitingAck' | 'awaitingDecision' | 'closing';

interface FlowState {
  phase: Phase;
  timer: ReturnType<typeof setTimeout> | null;
}

const flows = new Map<number, FlowState>();
let registered = false;
let quitRequested = false;

function isCloseDecision(value: unknown): value is CloseDecision {
  return value === 'acknowledged' || value === 'close' || value === 'cancel';
}

function clearTimer(state: FlowState): void {
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

function cancelClose(state: FlowState): void {
  clearTimer(state);
  state.phase = 'idle';
  quitRequested = false;
}

function finishClose(win: BrowserWindow, state: FlowState): void {
  clearTimer(state);
  state.phase = 'closing';
  const shouldQuit = quitRequested;
  if (!win.isDestroyed()) win.close();
  if (shouldQuit) app.quit();
}

function onConfirmClose(event: IpcMainEvent, raw: unknown): void {
  if (!isCloseDecision(raw)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  if (win.webContents !== event.sender) return;
  const state = flows.get(win.id);
  if (!state) return;

  if (raw === 'acknowledged') {
    if (state.phase !== 'awaitingAck') return;
    clearTimer(state);
    state.phase = 'awaitingDecision';
    return;
  }

  if (state.phase !== 'awaitingAck' && state.phase !== 'awaitingDecision') return;
  if (raw === 'cancel') {
    cancelClose(state);
    return;
  }
  finishClose(win, state);
}

// Se llama una sola vez al arrancar la app.
export function registerCloseFlow(): void {
  if (registered) return;
  registered = true;
  ipcMain.on(confirmCloseChannel, onConfirmClose);
  // Archivo -> Salir (app.quit) pasa por aquí; si el usuario cancela, se olvida la intención de salir.
  app.on('before-quit', () => {
    quitRequested = true;
  });
}

// Se llama por cada ventana creada.
export function attachCloseFlow(win: BrowserWindow): void {
  const id = win.id;
  const contents = win.webContents;
  const state: FlowState = { phase: 'idle', timer: null };
  flows.set(id, state);

  win.on('close', (event) => {
    if (state.phase === 'closing') return;
    if (state.phase === 'idle' && (contents.isDestroyed() || contents.isCrashed())) {
      state.phase = 'closing';
      return;
    }
    event.preventDefault();
    // Ya hay una solicitud en curso: se ignora la repetida.
    if (state.phase !== 'idle') return;
    state.phase = 'awaitingAck';
    state.timer = setTimeout(() => {
      state.timer = null;
      if (state.phase === 'awaitingAck') finishClose(win, state);
    }, ackTimeoutMs);
    contents.send(closeRequestedChannel);
  });

  contents.on('render-process-gone', () => {
    if (state.phase === 'awaitingAck' || state.phase === 'awaitingDecision') finishClose(win, state);
  });

  // Una recarga del renderer pierde el modal: se cancela la solicitud pendiente.
  contents.on('did-start-loading', () => {
    if (state.phase === 'awaitingAck' || state.phase === 'awaitingDecision') cancelClose(state);
  });

  win.on('closed', () => {
    clearTimer(state);
    flows.delete(id);
  });
}
