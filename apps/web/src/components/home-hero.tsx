'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowRight, Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// One setting controls the time each slide stays on screen.
export const HERO_AUTOPLAY_INTERVAL_MS = 6000;
const slides = [
  { src: '/images/home-slider-cover.jpg', alt: 'Get Stoopy: Shop Smart. Live Better. Discover a world of amazing products with unbeatable prices. Your trusted online store. Fast delivery.', name: 'Welcome to Get Stoopy' },
  { src: '/images/hero-market.jpg', alt: 'A shopper with burgundy bags in a warm, bustling market, with a delivery scooter nearby.', name: 'Everyday discoveries' },
] as const;

export function HomeHero() {
  const [active, setActive] = useState(0);
  const [eligible, setEligible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [announcement, setAnnouncement] = useState('');
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px) and (hover: hover) and (pointer: fine)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setEligible(desktop.matches && !reduced.matches);
    const visibility = () => setVisible(!document.hidden);
    update(); visibility();
    desktop.addEventListener('change', update); reduced.addEventListener('change', update);
    document.addEventListener('visibilitychange', visibility);
    return () => { desktop.removeEventListener('change', update); reduced.removeEventListener('change', update); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => {
    if (!eligible || paused || hovered || focused || !visible) return;
    const timer = window.setTimeout(() => setActive(index => (index + 1) % slides.length), HERO_AUTOPLAY_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [active, eligible, paused, hovered, focused, visible]);

  function go(index: number) {
    const next = (index + slides.length) % slides.length;
    setActive(next);
    setAnnouncement(`Slide ${next + 1} of ${slides.length}: ${slides[next]!.name}`);
  }

  return (
    <section className="home-hero" aria-label="Featured collections" aria-roledescription="carousel" data-slide={active} data-motion={eligible && !paused && !hovered && !focused && visible ? 'running' : 'paused'}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
      <div className="hero-stage" onTouchStart={event => { const point = event.touches[0]; touch.current = point ? { x: point.clientX, y: point.clientY } : null; }}
        onTouchEnd={event => { const start = touch.current; touch.current = null; const end = event.changedTouches[0]; if (!start || !end) return; const dx = end.clientX - start.x; const dy = end.clientY - start.y; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.25) go(active + (dx < 0 ? 1 : -1)); }}
        onTouchCancel={() => { touch.current = null; }}>
        {slides.map((slide, index) => (
          <div key={slide.src} className={`hero-slide ${index === active ? 'is-active' : ''} ${index === 1 ? 'hero-slide-generated' : ''}`} aria-hidden={index !== active} role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${slides.length}: ${slide.name}`}>
            {/* User-provided cover remains unmodified and fully visible. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={slide.src} alt={slide.alt} width={1463} height={526} fetchPriority={index === 0 ? 'high' : 'low'} loading={index === 0 ? 'eager' : 'lazy'} />
          </div>
        ))}
        <button className="hero-arrow hero-arrow-prev" type="button" aria-label="Previous slide" onClick={() => go(active - 1)}><ArrowLeft size={19} aria-hidden="true" /></button>
        <button className="hero-arrow hero-arrow-next" type="button" aria-label="Next slide" onClick={() => go(active + 1)}><ArrowRight size={19} aria-hidden="true" /></button>
      </div>
      <div className="hero-bottom">
        <div className="site-container hero-bottom-inner">
          <div className="hero-copy"><p className="section-eyebrow">Welcome to Get Stoopy</p><h1 id="hero-title">Shop smart. <span>Live better.</span></h1><p>Everyday inspiration, all in one place.</p></div>
          <Link href="/shop" className="hero-shop-link">Explore the shop <ArrowRight size={17} aria-hidden="true" /></Link>
          <div className="hero-controls" aria-label="Slide controls">
            <div className="hero-dots" aria-label="Choose a slide">{slides.map((slide, index) => <button key={slide.src} type="button" aria-label={`Show slide ${index + 1}: ${slide.name}`} aria-current={active === index ? 'true' : undefined} onClick={() => go(index)}><span /></button>)}</div>
            <button type="button" className="hero-play" disabled={!eligible} onClick={() => setPaused(value => !value)} aria-label={eligible ? paused ? 'Play automatic slideshow' : 'Pause automatic slideshow' : 'Autoplay is off on mobile or with reduced motion'} title={eligible ? paused ? 'Play slideshow' : 'Pause slideshow' : 'Autoplay is off on mobile or with reduced motion'}>{paused || !eligible ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}<span>{!eligible ? 'Autoplay off' : paused ? 'Play' : 'Pause'}</span></button>
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
    </section>
  );
}
