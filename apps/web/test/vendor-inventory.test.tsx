import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import InventoryPage from '../src/app/vendor/inventory/page';

describe('vendor inventory workspace', () => {
  it('does not mistake unavailable data for an empty inventory', () => {
    const html = renderToStaticMarkup(<InventoryPage />);
    expect(html).toContain('Store inventory is not connected here.');
    expect(html).toContain('This does not mean your inventory is empty.');
    expect(html).toContain('Calculation only, not live inventory.');
    expect(html).toContain('not saved or sent to the store');
    expect(html).toContain('href="/vendor"');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<button');
  });
});
