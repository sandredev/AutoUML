import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDownIcon } from './Icons';

export interface MenuButtonItem {
  id: string;
  label: string;
  /** Texto secundario a la derecha (atajo). */
  hint?: string;
  /** Si está definido, el elemento es una opción excluyente y este es su estado. */
  checked?: boolean;
  disabled?: boolean;
  run: () => void;
}

interface Props {
  label: ReactNode;
  /** Nombre accesible si `label` no es texto. */
  ariaLabel?: string;
  title?: string;
  items: readonly MenuButtonItem[];
  className?: string;
  /** Alinea el menú al borde derecho del botón. */
  alignEnd?: boolean;
  disabled?: boolean;
}

/**
 * Botón con menú desplegable (T11). Teclado: Intro/Espacio/↓ abren y llevan al primer elemento; ↑/↓ recorren,
 * Inicio/Fin saltan, Esc y Tab cierran (Esc devuelve el foco al botón). Un clic fuera también cierra.
 */
export function MenuButton({ label, ariaLabel, title, items, className = '', alignEnd = false, disabled = false }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    // El primer elemento habilitado recibe el foco al abrir.
    rootRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus();
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const all = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []);
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      all[(i + step + all.length) % all.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? all[0] : all[all.length - 1])?.focus();
    }
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div ref={rootRef} className={`menu-button ${className}`.trim()}>
      <button
        ref={buttonRef}
        type="button"
        className={open ? 'ghost-btn is-open' : 'ghost-btn'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKey}
      >
        {label}
        <ChevronDownIcon />
      </button>
      {open && (
        <div id={menuId} role="menu" className={alignEnd ? 'menu-popup align-end' : 'menu-popup'} onKeyDown={onMenuKey}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="menu-item"
              role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={item.checked}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
                item.run();
              }}
            >
              <span className="menu-check" aria-hidden="true">{item.checked ? '✓' : ''}</span>
              <span className="menu-label">{item.label}</span>
              {item.hint && <span className="menu-shortcut">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
