import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ProductPreviewPage from '../src/app/vendor/product-preview/page';
import { ProductPreviewEditor } from '../src/components/product-preview-editor';

describe('vendor product layout preview', () => {
  it('clearly explains that entries are local and transient, not saved or published', () => {
    const html = renderToStaticMarkup(<ProductPreviewPage />);
    expect(html).toContain('Preview only — nothing is saved or published.');
    expect(html).toContain('lost when you reload or leave');
    expect(html).toContain('Do not enter sensitive information');
    expect(html).toContain('href="/vendor"');
    expect(html).toContain('href="/vendor/variants-preview"');
    expect(html).toContain('does not create catalog variants');
  });
  it('renders labeled fields with the catalog detail length limits', () => {
    const html = renderToStaticMarkup(<ProductPreviewEditor />);
    expect(html).toContain('for="preview-title"');
    expect(html).toContain('for="preview-brand"');
    expect(html).toContain('for="preview-description"');
    expect(html).toMatch(/id="preview-title"[^>]*maxLength="200"/);
    expect(html).toMatch(/id="preview-brand"[^>]*maxLength="120"/);
    expect(html).toMatch(/id="preview-description"[^>]*maxLength="5000"/);
  });
  it('does not present unimplemented operations as functioning controls', () => {
    const html = renderToStaticMarkup(<ProductPreviewEditor />);
    expect(html).toContain('Not a listing');
    expect(html).toContain('Product management and submission are not connected');
    expect(html).toContain('Price unavailable');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<button');
  });
});
