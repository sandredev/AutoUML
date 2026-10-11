// src/presentation/components/ContextMenu.tsx — menú contextual accesible (T8).
// role="menu" con elementos role="menuitem" y foco itinerante: flechas, Inicio/Fin, Intro/Espacio activan,
// Esc y Tab cierran. Al abrir enfoca el primer elemento habilitado y al cerrar devuelve el foco a donde
// estaba. Posición fija en el punto pedido, sin salirse de la ventana.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';

export interface ContextMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  /** Atajo que se muestra a la derecha (y se anuncia con aria-keyshortcuts). */
  shortcut?: string;
}

interface Props {
  /** Punto de apertura, en coordenadas de la ventana. */
  x: number;
  y: number;
  label: string;
  items: readonly ContextMenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

const MARGIN = 4;

/** Esquina superior izquierda para que un menú w×h abierto en (x, y) quepa en una ventana vw×vh. */
export function clampMenuPosition(x: number, y: number, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  const left = x + w > vw - MARGIN ? x - w : x;
  const top = y + h > vh - MARGIN ? y - h : y;
  return {
    left: Math.max(MARGIN, Math.min(left, vw - MARGIN - w)),
    top: Math.max(MARGIN, Math.min(top, vh - MARGIN - h)),
  };
}

/** Índice al que lleva una tecla de navegación saltando los deshabilitados (-1 si no hay ninguno). */
export function nextEnabledIndex(disabled: readonly boolean[], current: number, key: string): number {
  const n = disabled.length;
  const enabled = (i: number): boolean => disabled[i] !== true;
  if (!disabled.some((d) => d !== true)) return -1;
  const scan = (start: number, step: number): number => {
    for (let k = 0, i = start; k < n; k++, i = (i + step + n) % n) if (enabled(i)) return i;
    return -1;
  };
  switch (key) {
    case 'ArrowDown': return scan((current + 1) % n, 1);
    case 'ArrowUp': return scan((current - 1 + n) % n, -1);
    case 'Home': return scan(0, 1);
    case 'End': return scan(n - 1, -1);
    default: return current;
  }
}

export function ContextMenu({ x, y, label, items, onSelect, onClose }: Props): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const disabled = items.map((it) => it.disabled === true);
  const [active, setActive] = useState(() => nextEnabledIndex(disabled, -1, 'Home'));
  const [pos, setPos] = useState({ left: x, top: y });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Posición dentro de la ventana (se mide antes de pintar: no hay salto visible).
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    setPos(clampMenuPosition(x, y, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight));
  }, [x, y, items.length]);

  // Foco: al abrir, al elemento activo; al cerrar, de vuelta a donde estaba.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (active >= 0) itemRefs.current[active]?.focus({ preventScroll: true });
  }, [active]);

  // Clic fuera, rueda, cambio de tamaño o ventana sin foco: se cierra.
  useEffect(() => {
    const close = (): void => closeRef.current();
    const onDown = (e: PointerEvent): void => {
      if (menuRef.current && e.target instanceof Node && !menuRef.current.contains(e.target)) close();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('wheel', close, { capture: true, passive: true });
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('wheel', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation(); // Esc no llega a los atajos del visor (salir del foco, quitar ruta)
      onClose();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const next = nextEnabledIndex(disabled, active, e.key);
      if (next >= 0) setActive(next);
    }
  };

  const activate = (i: number): void => {
    const item = items[i];
    if (!item || item.disabled) return;
    onSelect(item.id);
  };

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={label}
      aria-orientation="vertical"
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <button
          key={it.id}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          type="button"
          role="menuitem"
          className="context-menu-item"
          tabIndex={i === active ? 0 : -1}
          aria-disabled={it.disabled ? true : undefined}
          aria-keyshortcuts={it.shortcut}
          onClick={() => activate(i)}
          onPointerMove={() => {
            if (!it.disabled && i !== active) setActive(i);
          }}
        >
          <span className="context-menu-label">{it.label}</span>
          {it.shortcut ? <kbd className="context-menu-shortcut">{it.shortcut}</kbd> : null}
        </button>
      ))}
    </div>
  );
}
