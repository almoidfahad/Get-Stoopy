import type { Config } from 'tailwindcss';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
export default {
  content: [path.join(dir, 'src/**/*.{ts,tsx}')],
  theme: { extend: { colors: { brand: { red: '#D71920', dark: '#111111', charcoal: '#1F2937', gold: '#C9A227' } } } },
  plugins: []
} satisfies Config;
