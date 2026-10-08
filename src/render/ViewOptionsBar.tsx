// src/render/ViewOptionsBar.tsx — controles del panel "Vista" propios del visor (no sustituye menús ni Ajustes).
import type { ChangeEvent } from 'react';
import type { LayoutDirection, SummaryMode, ViewOptions } from './viewOptions';
import { DEFAULT_VIEW_OPTIONS, sameViewOptions } from './viewOptions';
import './viewer.css';

type Lang = 'es' | 'en';

const texts = {
  es: {
    title: 'Vista',
    summary: 'Tarjetas',
    auto: 'Según archivo',
    compact: 'Compactas',
    full: 'Con miembros',
    direction: 'Dirección',
    tb: 'Vertical',
    lr: 'Horizontal',
    ctors: 'Ocultar constructores',
    accessors: 'Ocultar getters/setters',
    reset: 'Restablecer',
  },
  en: {
    title: 'View',
    summary: 'Cards',
    auto: 'From file',
    compact: 'Compact',
    full: 'With members',
    direction: 'Direction',
    tb: 'Vertical',
    lr: 'Horizontal',
    ctors: 'Hide constructors',
    accessors: 'Hide getters/setters',
    reset: 'Reset',
  },
} as const;

interface Props {
  value: ViewOptions;
  onChange: (next: ViewOptions) => void;
  disabled?: boolean;
  lang?: Lang;
}

export function ViewOptionsBar({ value, onChange, disabled = false, lang = 'es' }: Props) {
  const t = texts[lang];
  const membersOff = disabled || value.summary === 'compact';
  const onSummary = (e: ChangeEvent<HTMLSelectElement>): void => {
    const v = e.target.value;
    if (v === 'auto' || v === 'compact' || v === 'full') onChange({ ...value, summary: v as SummaryMode });
  };
  const onDirection = (e: ChangeEvent<HTMLSelectElement>): void => {
    const v = e.target.value;
    if (v === 'TB' || v === 'LR') onChange({ ...value, direction: v as LayoutDirection });
  };
  return (
    <div className="view-options-bar" role="group" aria-label={t.title}>
      <span className="view-options-title">{t.title}</span>
      <label className="view-options-field">
        <span>{t.summary}</span>
        <select value={value.summary} onChange={onSummary} disabled={disabled}>
          <option value="auto">{t.auto}</option>
          <option value="compact">{t.compact}</option>
          <option value="full">{t.full}</option>
        </select>
      </label>
      <label className="view-options-field">
        <span>{t.direction}</span>
        <select value={value.direction} onChange={onDirection} disabled={disabled}>
          <option value="TB">{t.tb}</option>
          <option value="LR">{t.lr}</option>
        </select>
      </label>
      <label className="view-options-check">
        <input
          type="checkbox"
          checked={value.hideConstructors}
          disabled={membersOff}
          onChange={(e) => onChange({ ...value, hideConstructors: e.target.checked })}
        />
        <span>{t.ctors}</span>
      </label>
      <label className="view-options-check">
        <input
          type="checkbox"
          checked={value.hideAccessors}
          disabled={membersOff}
          onChange={(e) => onChange({ ...value, hideAccessors: e.target.checked })}
        />
        <span>{t.accessors}</span>
      </label>
      <button
        type="button"
        className="view-options-reset"
        disabled={disabled || sameViewOptions(value, DEFAULT_VIEW_OPTIONS)}
        onClick={() => onChange({ ...DEFAULT_VIEW_OPTIONS })}
      >
        {t.reset}
      </button>
    </div>
  );
}
