// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeHero, HERO_AUTOPLAY_INTERVAL_MS } from '../src/components/home-hero';

function media(desktop = true, reduced = false) {
  const desktopListeners = new Set<() => void>(); const motionListeners = new Set<() => void>();
  let desktopValue = desktop; let reducedValue = reduced;
  vi.stubGlobal('matchMedia', vi.fn((query: string) => {
    const isDesktop = query.includes('min-width'); const listeners = isDesktop ? desktopListeners : motionListeners;
    return { get matches() { return isDesktop ? desktopValue : reducedValue; }, media: query, addEventListener: (_: string, cb: () => void) => listeners.add(cb), removeEventListener: (_: string, cb: () => void) => listeners.delete(cb) };
  }));
  return { setDesktop: (value: boolean) => { desktopValue = value; act(() => desktopListeners.forEach(cb => cb())); }, setReduced: (value: boolean) => { reducedValue = value; act(() => motionListeners.forEach(cb => cb())); } };
}
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
function current() { return screen.getByRole('button', { name: /Show slide 1/ }).getAttribute('aria-current') === 'true' ? 1 : 2; }
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('homepage hero', () => {
  it('uses one six-second setting, pauses on hover and focus, and resumes after an explicit pause', () => {
    vi.useFakeTimers(); media(); render(<HomeHero />);
    expect(HERO_AUTOPLAY_INTERVAL_MS).toBe(6000);
    tick(5999); expect(current()).toBe(1);
    tick(1); expect(current()).toBe(2);
    const carousel = screen.getByRole('region', { name: 'Featured collections' });
    fireEvent.mouseEnter(carousel); tick(18000); expect(current()).toBe(2);
    fireEvent.mouseLeave(carousel); tick(6000); expect(current()).toBe(1);
    fireEvent.focus(screen.getByRole('button', { name: 'Next slide' })); tick(18000); expect(current()).toBe(1);
    fireEvent.blur(screen.getByRole('button', { name: 'Next slide' }), { relatedTarget: null });
    fireEvent.click(screen.getByRole('button', { name: 'Pause automatic slideshow' }));
    tick(18000); expect(current()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Play automatic slideshow' })); tick(6000); expect(current()).toBe(2);
  });
  it('disables autoplay for mobile and reduced motion, including preference changes', () => {
    vi.useFakeTimers(); const preference = media(false); render(<HomeHero />);
    tick(18000); expect(current()).toBe(1);
    expect((screen.getByRole('button', { name: /Autoplay is off/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' })); expect(current()).toBe(2);
    preference.setDesktop(true); preference.setReduced(true); tick(12000); expect(current()).toBe(2);
    preference.setReduced(false); tick(6000); expect(current()).toBe(1);
    preference.setDesktop(false); tick(12000); expect(current()).toBe(1);
  });
  it('supports dots and horizontal touch without intercepting vertical swipes', () => {
    media(false); const { container } = render(<HomeHero />);
    const stage = container.querySelector('.hero-stage')!;
    fireEvent.touchStart(stage, { touches: [{ clientX: 250, clientY: 30 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 80, clientY: 35 }] });
    expect(current()).toBe(2); expect(screen.getByText('Slide 2 of 2: Everyday discoveries')).toBeTruthy();
    fireEvent.touchStart(stage, { touches: [{ clientX: 100, clientY: 30 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 90, clientY: 180 }] });
    expect(current()).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: /Show slide 1/ })); expect(current()).toBe(1);
    expect(screen.getByRole('region', { name: 'Featured collections' }).getAttribute('data-slide')).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Previous slide' })); expect(current()).toBe(2);
    expect(screen.getByRole('region', { name: 'Featured collections' }).getAttribute('data-slide')).toBe('1');
  });
});
