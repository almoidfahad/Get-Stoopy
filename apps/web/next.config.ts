import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  output: 'standalone',
  experimental: { externalDir: true },
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' }
    ]},
    // OAuth callback URLs carry authorization codes. Override the general
    // policy so redirects never send their query string as a referrer.
    { source: '/api/auth/callback', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    { source: '/api/auth/link/callback', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    ];
  }
};
export default nextConfig;
