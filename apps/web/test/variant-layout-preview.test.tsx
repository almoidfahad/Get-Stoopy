// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VariantLayoutPreview } from '../src/components/variant-layout-preview';
import VariantsPreviewPage from '../src/app/vendor/variants-preview/page';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('vendor variant layout preview', () => {
  it('clearly states the boundary and has no form or catalog submission', () => {
    const { container } = render(<VariantsPreviewPage />);
    expect(screen.getByText(/Layout preview only — nothing is saved or submitted/)).toBeTruthy();
    expect(screen.getByText(/Do not enter sensitive information or real business data/)).toBeTruthy();
    expect(container.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: /save|publish|submit/i })).toBeNull();
  });
  it('adds and removes independent options without requests or persistent data', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    render(<VariantLayoutPreview />);
    fireEvent.click(screen.getByRole('button', { name: 'Add another preview option' }));
    const second = screen.getByRole('group', { name: 'Preview option 2' });
    expect(document.activeElement).toBe(within(second).getByLabelText('Option name'));
    fireEvent.change(within(second).getByLabelText('Option name'), { target: { value: 'Sample option' } });
    fireEvent.change(within(second).getByLabelText('SKU'), { target: { value: 'ABC-TEST' } });
    fireEvent.change(within(second).getByLabelText('Price in minor units'), { target: { value: '1234' } });
    fireEvent.change(within(second).getByLabelText('Currency code'), { target: { value: 'BDT' } });
    const preview = screen.getByRole('region', { name: 'Option layout' });
    expect(within(preview).getByText('Sample option')).toBeTruthy();
    expect(within(preview).getByText('1234 minor units (BDT)')).toBeTruthy();
    fireEvent.click(within(second).getByRole('button', { name: 'Remove preview option 2' }));
    expect(within(preview).queryByText('Sample option')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add another preview option' }));
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not display a zero, malformed or out-of-range price as valid', () => {
    render(<VariantLayoutPreview />);
    const price = screen.getByLabelText('Price in minor units');
    const currency = screen.getByLabelText('Currency code');
    fireEvent.change(currency, { target: { value: 'BDT' } });
    for (const value of ['0', '-1', '01', '9007199254740992']) {
      fireEvent.change(price, { target: { value } });
      expect(price.getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByText('Price not shown')).toBeTruthy();
    }
    fireEvent.change(price, { target: { value: '1' } });
    fireEvent.change(currency, { target: { value: 'bdt' } });
    expect(currency.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Price not shown')).toBeTruthy();
  });
  it('enforces only the clearly labelled preview option limit', () => {
    render(<VariantLayoutPreview />);
    const add = screen.getByRole('button', { name: 'Add another preview option' }) as HTMLButtonElement;
    for (let i = 1; i < 8; i++) fireEvent.click(add);
    expect(add.disabled).toBe(true);
    expect(screen.getByText('The preview limit has been reached.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove preview option 8' }));
    expect(add.disabled).toBe(false);
    expect(document.activeElement).toBe(add);
  });
});
