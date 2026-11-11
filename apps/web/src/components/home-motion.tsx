'use client';

import { useEffect } from 'react';

/** Progressive enhancement: content stays visible if JS or observers are unavailable. */
export function HomeMotion() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(min-width: 768px) and (hover: hover) and (pointer: fine)');
    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-home-reveal]'));
    const hero = document.querySelector<HTMLElement>('.home-hero');
    let observer: IntersectionObserver | undefined;
    let frame = 0;
    const revealAll = () => { observer?.disconnect(); observer = undefined; sections.forEach(section => section.removeAttribute('data-reveal-pending')); };
    const setup = () => {
      revealAll();
      if (reduced.matches || !('IntersectionObserver' in window)) return;
      observer = new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.removeAttribute('data-reveal-pending'); observer?.unobserve(entry.target); }
      }), { threshold: 0.06 });
      sections.forEach(section => {
        if (section.getBoundingClientRect().top >= window.innerHeight) section.setAttribute('data-reveal-pending', '');
        observer!.observe(section);
      });
    };
    const move = (event: PointerEvent) => {
      if (!hero || reduced.matches || !finePointer.matches || event.pointerType !== 'mouse') return;
      const rect = hero.getBoundingClientRect();
      const x = event.clientX - rect.left; const y = event.clientY - rect.top;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { hero.style.setProperty('--pointer-x', `${x}px`); hero.style.setProperty('--pointer-y', `${y}px`); hero.dataset.pointer = 'on'; });
    };
    const leave = () => { cancelAnimationFrame(frame); if (hero) delete hero.dataset.pointer; };
    setup(); reduced.addEventListener('change', setup); finePointer.addEventListener('change', leave);
    hero?.addEventListener('pointermove', move); hero?.addEventListener('pointerleave', leave);
    return () => { reduced.removeEventListener('change', setup); finePointer.removeEventListener('change', leave); hero?.removeEventListener('pointermove', move); hero?.removeEventListener('pointerleave', leave); leave(); revealAll(); };
  }, []);
  return null;
}
