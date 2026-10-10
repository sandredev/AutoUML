
import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent } from 'react';
import { CloseIcon, InfoIcon, LanguageIcon, PaletteIcon, SearchIcon, SystemIcon } from './Icons';
import { themeSwatches, type ThemeMode } from './useTheme';
import { useLocalization } from '../localization/LocalizationProvider';
import type { Locale, MessageKey } from '../localization/translations';
import { filterCategories, pickActive, type SettingsCategory } from './settingsModel';

interface Props {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onClose: () => void;
}

const focusableSelector = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

const themeOptions: { mode: ThemeMode; label: MessageKey }[] = [
  { mode: 'system', label: 'settings.themeSystem' },
  { mode: 'light', label: 'settings.themeLight' },
  { mode: 'dark', label: 'settings.themeDark' },
  { mode: 'midnight', label: 'settings.themeMidnight' },
  { mode: 'ember', label: 'settings.themeEmber' },
  { mode: 'sunrise', label: 'settings.themeSunrise' },
  { mode: 'contrast', label: 'settings.themeContrast' },
];

const localeOptions: { locale: Locale; label: MessageKey }[] = [
  { locale: 'es', label: 'settings.langEs' },
  { locale: 'en', label: 'settings.langEn' },
];

function categoryIcon(id: SettingsCategory): JSX.Element {
  if (id === 'appearance') return <PaletteIcon />;
  if (id === 'language') return <LanguageIcon />;
  return <InfoIcon />;
}

export function SettingsDialog({ themeMode, onThemeChange, onClose }: Props): JSX.Element {
  const { locale, setLocale, t } = useLocalization();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<SettingsCategory>('appearance');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const visible = useMemo(() => filterCategories(query, t), [query, t]);
  const shown = pickActive(active, visible);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    searchRef.current?.focus();
    return () => {
      previous?.focus();
    };
  }, []);

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
    const next = visible[(index + step + visible.length) % visible.length];
    if (!next) return;
    setActive(next.id);
    const el = dialogRef.current?.querySelector<HTMLButtonElement>('[data-cat="' + next.id + '"]');
    el?.focus();
  };

  const onOverlayDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay" onMouseDown={onOverlayDown}>
      <div
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={onKeyDown}
      >
        <div className="settings-header">
          <h2 id="settings-title">{t('settings.title')}</h2>
          <button type="button" className="icon-btn" title={t('settings.close')} aria-label={t('settings.close')} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="settings-layout">
          <div className="settings-side">
            <label className="settings-search">
              <SearchIcon />
              <input
                ref={searchRef}
                type="search"
                aria-label={t('settings.search')}
                placeholder={t('settings.searchPlaceholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <nav aria-label={t('settings.categories')}>
              <ul className="settings-nav">
                {visible.map((c, i) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      data-cat={c.id}
                      className={shown === c.id ? 'settings-nav-item selected' : 'settings-nav-item'}
                      aria-current={shown === c.id ? 'page' : undefined}
                      onClick={() => setActive(c.id)}
                      onKeyDown={(e) => onNavKey(e, i)}
                    >
                      {categoryIcon(c.id)}
                      <span>{t(c.title)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <section className="settings-content" aria-live="polite">
            {shown === null && <p className="muted">{t('settings.noResults')}</p>}
            {shown === 'appearance' && (
              <div>
                <h3 className="settings-crumb">{t('settings.appearance')}</h3>
                <fieldset className="settings-group">
                  <legend>{t('settings.themeLabel')}</legend>
                  <div className="theme-grid" role="radiogroup" aria-label={t('settings.themeLabel')}>
                    {themeOptions.map((o) => (
                      <button
                        key={o.mode}
                        type="button"
                        role="radio"
                        aria-checked={themeMode === o.mode}
                        className={themeMode === o.mode ? 'theme-card selected' : 'theme-card'}
                        onClick={() => onThemeChange(o.mode)}
                      >
                        <span className="theme-preview" aria-hidden="true">
                          {o.mode === 'system' ? (
                            <SystemIcon />
                          ) : (
                            themeSwatches[o.mode].map((color, i) => <span key={i} style={{ background: color }} />)
                          )}
                        </span>
                        <span className="theme-name">{t(o.label)}</span>
                      </button>
                    ))}
                  </div>
                  <p className="settings-hint">{t('settings.themeHint')}</p>
                </fieldset>
              </div>
            )}
            {shown === 'language' && (
              <div>
                <h3 className="settings-crumb">{t('settings.language')}</h3>
                <fieldset className="settings-group">
                  <legend>{t('settings.languageLabel')}</legend>
                  <div className="settings-segment" role="radiogroup" aria-label={t('settings.languageLabel')}>
                    {localeOptions.map((o) => (
                      <button
                        key={o.locale}
                        type="button"
                        role="radio"
                        lang={o.locale}
                        aria-checked={locale === o.locale}
                        className={locale === o.locale ? 'segment-btn selected' : 'segment-btn'}
                        onClick={() => setLocale(o.locale)}
                      >
                        <span>{t(o.label)}</span>
                      </button>
                    ))}
                  </div>
                  <p className="settings-hint">{t('settings.languageHint')}</p>
                </fieldset>
              </div>
            )}
            {shown === 'about' && (
              <div>
                <h3 className="settings-crumb">{t('settings.about')}</h3>
                <div className="settings-about">
                  <strong>AutoUML</strong>
                  <p>{t('settings.aboutDesc')}</p>
                  <p className="muted">{t('settings.aboutRule')}</p>
                </div>
              </div>
            )}
          </section>
        </div>
        <div className="settings-footer">
          <button type="button" className="btn" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
