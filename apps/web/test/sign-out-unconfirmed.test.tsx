import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SignOutUnconfirmed, { metadata } from '../src/app/sign-out-unconfirmed/page';

describe('unconfirmed sign-out recovery', () => {
  it('explains the local and server/provider session distinction without a backend read', () => {
    const html = renderToStaticMarkup(<SignOutUnconfirmed />);
    expect(html).toContain('<h1');
    expect(html).toContain('Server sign-out could not be confirmed');
    expect(html).toContain('browser was asked to clear its Get Stoopy session cookie');
    expect(html).toContain('server session may still be active');
    expect(html).toContain('sign-in provider or other devices may also remain signed in');
    expect(html).toContain('closing the browser alone may not sign you out');
    expect(html).toContain('href="/account"');
    expect(html).toContain('href="/shop"');
    expect(html).not.toContain('Sign-out successful');
    expect(metadata.robots.index).toBe(false);
  });
});
