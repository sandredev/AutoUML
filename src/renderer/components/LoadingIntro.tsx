import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { INTRO_BOOT_MIN_MS, INTRO_EXIT_MS, INTRO_SHOW_DELAY_MS } from './introState';
import './loadingIntro.css';

export interface LoadingIntroProps {
  active: boolean;
}

type Phase = 'hidden' | 'loading' | 'exiting';

const LOGO_SIZE = 160;

// Overlay de carga solo sobre el área de render del gráfico. Se muestra de inmediato en el
// arranque (con un mínimo para que se vea) y, en cargas posteriores, solo si superan INTRO_SHOW_DELAY_MS.
// Solo anima transform/opacity (CSS); no hay trabajo por frame en JS.
export function LoadingIntro({ active }: LoadingIntroProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>(active ? 'loading' : 'hidden');
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const shownAtRef = useRef<number>(performance.now());
  const bootRef = useRef(active);

  useEffect(() => {
    if (active) {
      if (phaseRef.current === 'loading') return;
      const id = window.setTimeout(
        () => {
          shownAtRef.current = performance.now();
          setPhase('loading');
        },
        phaseRef.current === 'exiting' ? 0 : INTRO_SHOW_DELAY_MS,
      );
      return () => window.clearTimeout(id);
    }
    if (phaseRef.current !== 'loading') return;
    const hold = bootRef.current ? Math.max(0, INTRO_BOOT_MIN_MS - (performance.now() - shownAtRef.current)) : 0;
    let exitId: number | undefined;
    const holdId = window.setTimeout(() => {
      bootRef.current = false;
      setPhase('exiting');
      exitId = window.setTimeout(() => setPhase('hidden'), INTRO_EXIT_MS);
    }, hold);
    return () => {
      window.clearTimeout(holdId);
      window.clearTimeout(exitId);
    };
  }, [active]);

  if (phase === 'hidden') return null;

  return (
    <>
      <div className={`loading-intro is-${phase}`} aria-hidden="true">
        <svg className="loading-intro-logo" viewBox="0 0 512 512" width={LOGO_SIZE} height={LOGO_SIZE} focusable="false">
          <rect width="512" height="512" rx="112" fill="#FF5F3C" />
          <g className="li-cards">
            <rect x="70" y="60" width="64" height="44" rx="6" fill="#F1F1F1" stroke="#181818" strokeWidth="4" />
            <rect x="378" y="60" width="64" height="44" rx="6" fill="#F1F1F1" stroke="#181818" strokeWidth="4" />
            <rect x="70" y="430" width="64" height="44" rx="6" fill="#F1F1F1" stroke="#181818" strokeWidth="4" />
            <rect x="378" y="430" width="64" height="44" rx="6" fill="#F1F1F1" stroke="#181818" strokeWidth="4" />
          </g>
          <g className="li-a">
            <polygon points="205,80 300,80 442,412 356,412 328,340 186,340 164,412 68,412" fill="#1E2033" />
            <polygon points="256,158 296,250 214,250" fill="#FF5F3C" />
          </g>
          <rect className="li-tab" x="82" y="256" width="110" height="80" rx="10" fill="#1E2033" />
          <polygon className="li-diamond" points="338,256 364,282 338,308 312,282" fill="#F5D33B" />
          <path className="li-spark" d="M0,-9 L9,0 L0,9 L-9,0Z" fill="#F5D33B" />
        </svg>
        <div className="loading-intro-bar">
          <span className="loading-intro-bar-thumb" />
        </div>
      </div>
      <div className="loading-intro-live" role="status" aria-live="polite">
        {phase === 'loading' ? t('intro.loading') : ''}
      </div>
    </>
  );
}
