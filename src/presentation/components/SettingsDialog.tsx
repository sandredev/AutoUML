import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent } from 'react';
import type { AppInfo } from '../../application/ports/ipc';
import { CloseIcon } from './Icons';
import { themeSwatches, type ThemeMode } from './useTheme';
import { useLocalization } from '../localization/LocalizationProvider';
import type { Locale, MessageKey } from '../localization/translations';
import { settingsCategories, type SettingsCategory } from './settingsModel';
import './settings.css';
import type { ThemeId } from '../../domain/rules/themes';

/** Último diagrama calculado (Acerca de › Información técnica). */
export interface LastDiagramInfo {
  name: string;
  types: number;
  ms: number | null;
}

interface Props {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onClose: () => void;
  /** Sección con la que se abre (Ayuda › Acerca de abre directamente "about"). */
  initial?: SettingsCategory;
  lastDiagram?: LastDiagramInfo | null;
}

const focusableSelector = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const themeOptions: { mode: ThemeMode; label: MessageKey }[] = [
  { mode: 'system', label: 'settings.themeSystem' },
  { mode: 'light', label: 'settings.themeLight' },
  { mode: 'dark', label: 'settings.themeDark' },
  { mode: 'contrast', label: 'settings.themeContrast' },
];

const localeOptions: { locale: Locale; label: MessageKey }[] = [
  { locale: 'es', label: 'settings.langEs' },
  { locale: 'en', label: 'settings.langEn' },
];

/** Miniatura de un tema: barra, panel lateral, acento y dos tarjetas con los colores reales. */
function Preview({ id }: { id: ThemeId }): JSX.Element {
  const c = themeSwatches[id];
  return (
    <span className="theme-mini" style={{ background: c.canvas }} aria-hidden="true">
      <span className="theme-mini-bar" style={{ background: c.panel, borderColor: c.line }} />
      <span className="theme-mini-side" style={{ background: c.panel, borderColor: c.line }}>
        <span style={{ background: c.accent }} />
      </span>
      <span className="theme-mini-card a" style={{ background: c.card, borderColor: c.edge }} />
      <span className="theme-mini-card b" style={{ background: c.card, borderColor: c.edge }} />
    </span>
  );
}

function ThemePreview({ mode }: { mode: ThemeMode }): JSX.Element {
  if (mode !== 'system') return <Preview id={mode} />;
  // Sistema: mitad Claro, mitad Oscuro.
  return (
    <span className="theme-mini-split" aria-hidden="true">
      <Preview id="light" />
      <span className="theme-mini-half"><Preview id="dark" /></span>
    </span>
  );
}

export function SettingsDialog({ themeMode, onThemeChange, onClose, initial = 'appearance', lastDiagram = null }: Props): JSX.Element {
  const { locale, setLocale, t } = useLocalization();
  const [active, setActive] = useState<SettingsCategory>(initial);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLButtonElement>('.settings-nav-item.selected')?.focus();
    return () => {
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    if (active !== 'about' || info) return;
    let cancelled = false;
    void window.autouml?.getAppInfo?.().then((v) => {
      if (!cancelled) setInfo(v);
    });
    return () => {
      cancelled = true;
    };
  }, [active, info]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onNavKey = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = settingsCategories[(index + step + settingsCategories.length) % settingsCategories.length];
    if (!next) return;
    setActive(next.id);
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-cat="' + next.id + '"]')?.focus();
  };

  /** Flechas dentro de un grupo de opciones excluyentes (tema, idioma). */
  const onRadioKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const i = radios.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = radios[(i + step + radios.length) % radios.length];
    next?.focus();
    next?.click();
  };

  const onOverlayDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) onClose();
  };

  const copy = (text: string, what: string): void => {
    void navigator.clipboard.writeText(text).then(
      () => setCopied(what),
      () => setCopied(null),
    );
  };

  const lastText = lastDiagram
    ? t('settings.lastDiagramValue', { name: lastDiagram.name, types: lastDiagram.types })
      + (lastDiagram.ms !== null ? ' · ' + t('settings.seconds', { s: (lastDiagram.ms / 1000).toLocaleString(locale === 'en' ? 'en-US' : 'es-CO', { maximumFractionDigits: 1 }) }) : '')
    : t('settings.noDiagram');
  const techText = info
    ? [
        `AutoUML ${info.version}${info.dev ? ' (' + t('settings.devBuild') + ')' : ''}`,
        `${t('settings.lastDiagram')}: ${lastText}`,
        `${t('settings.versions')}: Electron ${info.electron} · Chromium ${info.chrome}`,
        `${t('settings.system')}: ${info.os}`,
        `${t('settings.dataPath')}: ${info.dataPath}`,
      ].join('\n')
    : '';

  return (
    <div className="modal-overlay" onMouseDown={onOverlayDown}>
      <div ref={dialogRef} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onKeyDown={onKeyDown}>
        <div className="settings-header">
          <h2 id="settings-title">{t('settings.title')}</h2>
          <button type="button" className="icon-btn" title={t('settings.close')} aria-label={t('settings.close')} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="settings-layout">
          <nav className="settings-side" aria-label={t('settings.categories')}>
            {settingsCategories.map((c, i) => (
              <button
                key={c.id}
                type="button"
                data-cat={c.id}
                className={active === c.id ? 'settings-nav-item selected' : 'settings-nav-item'}
                aria-current={active === c.id ? 'page' : undefined}
                onClick={() => setActive(c.id)}
                onKeyDown={(e) => onNavKey(e, i)}
              >
                {t(c.title)}
              </button>
            ))}
          </nav>
          <section className="settings-content">
            {active === 'appearance' && (
              <>
                <h3 id="settings-theme" className="settings-h">{t('settings.themeLabel')}</h3>
                <div className="theme-grid" role="radiogroup" aria-labelledby="settings-theme" onKeyDown={onRadioKey}>
                  {themeOptions.map((o) => (
                    <button
                      key={o.mode}
                      type="button"
                      role="radio"
                      aria-checked={themeMode === o.mode}
                      tabIndex={themeMode === o.mode ? 0 : -1}
                      className={themeMode === o.mode ? 'theme-card selected' : 'theme-card'}
                      onClick={() => onThemeChange(o.mode)}
                    >
                      <ThemePreview mode={o.mode} />
                      <span className="theme-name">{t(o.label)}</span>
                      {o.mode === 'system' && <span className="theme-sub">{t('settings.themeSystemHint')}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
            {active === 'language' && (
              <>
                <h3 id="settings-lang" className="settings-h">{t('settings.languageLabel')}</h3>
                <div className="settings-segment" role="radiogroup" aria-labelledby="settings-lang" onKeyDown={onRadioKey}>
                  {localeOptions.map((o) => (
                    <button
                      key={o.locale}
                      type="button"
                      role="radio"
                      lang={o.locale}
                      aria-checked={locale === o.locale}
                      tabIndex={locale === o.locale ? 0 : -1}
                      className={locale === o.locale ? 'segment-btn selected' : 'segment-btn'}
                      onClick={() => setLocale(o.locale)}
                    >
                      {t(o.label)}
                    </button>
                  ))}
                </div>
                <p className="settings-hint">{t('settings.languageHint')}</p>
              </>
            )}
            {active === 'about' && (
              <div className="settings-about">
                <div className="about-head">
                  <img src="./favicon.png" alt="" aria-hidden="true" />
                  <div>
                    <h3 className="about-title">AutoUML {info?.version ?? ''}</h3>
                    <p className="muted">{t('settings.aboutDesc')}</p>
                  </div>
                </div>
                <h4 className="settings-sub">{t('settings.techInfo')}</h4>
                <dl className="about-kv">
                  <dt>{t('settings.lastDiagram')}</dt>
                  <dd>{lastText}</dd>
                  <dt>{t('settings.dataPath')}</dt>
                  <dd>
                    <span className="about-path">{info?.dataPath ?? '…'}</span>
                    <span className="about-actions">
                      <button type="button" className="btn btn-small" disabled={!info} onClick={() => info && copy(info.dataPath, 'path')}>{t('settings.copyPath')}</button>
                      <button type="button" className="btn btn-small" disabled={!info} onClick={() => void window.autouml.openDataFolder()}>{t('settings.openFolder')}</button>
                    </span>
                  </dd>
                  <dt>{t('settings.versions')}</dt>
                  <dd>{info ? `Electron ${info.electron} · Chromium ${info.chrome}` : '…'}</dd>
                  <dt>{t('settings.system')}</dt>
                  <dd>{info?.os ?? '…'}</dd>
                  {info?.dev && (
                    <>
                      <dt>{t('settings.mode')}</dt>
                      <dd>{t('settings.devBuild')}</dd>
                    </>
                  )}
                </dl>
                <div className="about-copy">
                  <button type="button" className="btn" disabled={!info} onClick={() => copy(techText, 'tech')}>{t('settings.copyTech')}</button>
                  <span className="muted" role="status">{copied === 'tech' ? t('settings.copiedTech') : copied === 'path' ? t('settings.copiedPath') : ''}</span>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
