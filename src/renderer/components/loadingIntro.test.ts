import { describe, expect, it } from 'vitest';
import { isIntroActive } from './loadingIntro';

const idle = { booting: false, documentLoading: false, layoutLoading: false };

describe('isIntroActive', () => {
  it('está inactiva cuando no hay ninguna carga en curso', () => {
    expect(isIntroActive(idle)).toBe(false);
  });

  it('está activa mientras arranca la app', () => {
    expect(isIntroActive({ ...idle, booting: true })).toBe(true);
  });

  it('está activa mientras se lee o parsea un documento', () => {
    expect(isIntroActive({ ...idle, documentLoading: true })).toBe(true);
  });

  it('está activa mientras se calcula el layout', () => {
    expect(isIntroActive({ ...idle, layoutLoading: true })).toBe(true);
  });

  it('se mantiene activa mientras quede cualquier carga, aunque las demás terminen', () => {
    expect(isIntroActive({ booting: false, documentLoading: false, layoutLoading: true })).toBe(true);
  });
});
