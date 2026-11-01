import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: { colors: { brand: { red: '#D71920', dark: '#111111', charcoal: '#1F2937', gold: '#C9A227' } } } },
  plugins: []
} satisfies Config;
