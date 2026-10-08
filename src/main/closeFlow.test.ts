import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  appOn: vi.fn(),
  appQuit: vi.fn(),
  ipcOn: vi.fn(),
  fromWebContents: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { on: electronMocks.appOn, quit: electronMocks.appQuit },
  ipcMain: { on: electronMocks.ipcOn },
  BrowserWindow: { fromWebContents: electronMocks.fromWebContents },
}));

import { attachCloseFlow, registerCloseFlow } from './closeFlow';

type Listener = (...args: unknown[]) => void;

interface FakeWindow {
  id: number;
  destroyed: boolean;
  isDestroyed: ReturnType<typeof vi.fn>;
  webContents: {
    isDestroyed: ReturnType<typeof vi.fn>;
    isCrashed: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  emitClose(): { preventDefault: ReturnType<typeof vi.fn> };
}

let confirmListener: Listener;
let beforeQuitListener: Listener;
let nextWindowId = 1;

function makeWindow(): FakeWindow {
  const windowListeners = new Map<string, Listener>();
  const contentsListeners = new Map<string, Listener>();
  const contents = {
    isDestroyed: vi.fn(() => false),
    isCrashed: vi.fn(() => false),
    send: vi.fn(),
    on: vi.fn((event: string, listener: Listener) => contentsListeners.set(event, listener)),
  };
  let win: FakeWindow;
  win = {
    id: nextWindowId++,
    destroyed: false,
    isDestroyed: vi.fn(() => win.destroyed),
    webContents: contents,
    on: vi.fn((event: string, listener: Listener) => windowListeners.set(event, listener)),
    close: vi.fn(() => {
      win.emitClose();
      win.destroyed = true;
      windowListeners.get('closed')?.();
    }),
    emitClose: () => {
      const event = { preventDefault: vi.fn() };
      windowListeners.get('close')?.(event);
      return event;
    },
  } satisfies FakeWindow;
  electronMocks.fromWebContents.mockReturnValue(win);
  attachCloseFlow(win as never);
  return win;
}

function confirm(win: FakeWindow, decision: string): void {
  confirmListener({ sender: win.webContents }, decision);
}

beforeAll(() => {
  electronMocks.ipcOn.mockImplementation((_channel: string, listener: Listener) => {
    confirmListener = listener;
  });
  electronMocks.appOn.mockImplementation((event: string, listener: Listener) => {
    if (event === 'before-quit') beforeQuitListener = listener;
  });
  registerCloseFlow();
});

beforeEach(() => {
  vi.useFakeTimers();
  electronMocks.appQuit.mockClear();
});

describe('close flow', () => {
  it('waits for the renderer decision after its acknowledgement and can cancel', () => {
    const win = makeWindow();

    const firstClose = win.emitClose();
    expect(firstClose.preventDefault).toHaveBeenCalledOnce();
    expect(win.webContents.send).toHaveBeenCalledWith('app:close-requested');
    expect(win.emitClose().preventDefault).toHaveBeenCalledOnce();
    expect(win.webContents.send).toHaveBeenCalledOnce();

    confirm(win, 'acknowledged');
    vi.advanceTimersByTime(2500);
    expect(win.close).not.toHaveBeenCalled();

    confirm(win, 'cancel');
    const secondClose = win.emitClose();
    expect(secondClose.preventDefault).toHaveBeenCalledOnce();
    expect(win.webContents.send).toHaveBeenCalledTimes(2);
  });

  it('closes automatically when the renderer does not acknowledge within two seconds', () => {
    const win = makeWindow();
    win.emitClose();

    vi.advanceTimersByTime(1999);
    expect(win.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(win.close).toHaveBeenCalledOnce();
    expect(win.destroyed).toBe(true);
  });

  it('ignores invalid decisions and messages from a different webContents', () => {
    const win = makeWindow();
    win.emitClose();

    confirm(win, 'unexpected');
    confirmListener({ sender: {} }, 'close');

    expect(win.close).not.toHaveBeenCalled();
    expect(win.emitClose().preventDefault).toHaveBeenCalledOnce();
  });

  it('finishes app.quit after a close requested by the application', () => {
    const win = makeWindow();
    beforeQuitListener();
    win.emitClose();
    confirm(win, 'acknowledged');
    confirm(win, 'close');

    expect(win.close).toHaveBeenCalledOnce();
    expect(electronMocks.appQuit).toHaveBeenCalledOnce();
  });

  it('allows the window to close when the renderer process crashes', () => {
    const win = makeWindow();
    win.emitClose();
    const listener = win.webContents.on.mock.calls.find(([event]) => event === 'render-process-gone')?.[1] as Listener;

    listener();

    expect(win.close).toHaveBeenCalledOnce();
    expect(win.destroyed).toBe(true);
  });
});
