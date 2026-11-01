import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Get Stoopy', description: 'Shop Smart. Live Better.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
