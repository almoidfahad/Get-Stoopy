import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import VendorOrdersPage from '../src/app/vendor/orders/page';

describe('vendor orders layout preview', () => {
  const html = renderToStaticMarkup(<VendorOrdersPage />);
  it('distinguishes unavailable records from an empty store', () => {
    expect(html).toContain('Layout preview only.');
    expect(html).toContain('Real orders, store selection and order actions are not connected here.');
    expect(html).toContain('This does not mean there are no orders.');
    expect(html).toContain('Order records unavailable');
    expect(html).not.toContain('#GS1001');
    expect(html).not.toContain('$59.99');
  });
  it('provides a labeled scrollable table and working dashboard navigation', () => {
    expect(html).toContain('href="/vendor"');
    expect(html).toContain('Orders table, scroll horizontally if needed');
    expect(html).toContain('<caption');
    expect(html).toContain('scope="col"');
    expect(html).toContain('colSpan="4"');
  });
  it('explains the readiness path without claiming status or presenting fake actions', () => {
    expect(html).toContain('Process guidance only—not the status of an actual order.');
    expect(html).toContain('Rejection is an alternative to acceptance.');
    expect(html).toContain('a timer cannot confirm it');
    expect(html).toContain('Additional delivery, cancellation and exception states are not shown');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<form');
  });
});
