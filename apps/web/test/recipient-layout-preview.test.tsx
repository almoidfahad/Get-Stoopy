// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecipientLayoutPreview } from '../src/components/recipient-layout-preview';
import RecipientPreviewPage from '../src/app/checkout/recipient-preview/page';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('recipient details layout preview', () => {
  it('is explicitly a preview, with no enabled personal data fields or order action', () => {
    render(<RecipientPreviewPage />);
    expect(screen.getByText(/Layout preview only — not an order form/)).toBeTruthy();
    for (const label of ['Recipient name', 'Recipient phone', 'Destination city', 'Delivery address', /Delivery instructions/]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).matches(':disabled')).toBe(true);
    }
    expect(screen.queryByRole('button', { name: /save|order|submit|pay/i })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to checkout' }).getAttribute('href')).toBe('/checkout');
  });
  it('switches between buyer-as-recipient and someone else without sending data', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    render(<RecipientLayoutPreview />);
    const myself = screen.getByRole('radio', { name: /Myself/ }) as HTMLInputElement;
    const other = screen.getByRole('radio', { name: /Someone else/ }) as HTMLInputElement;
    expect(myself.checked).toBe(true);
    fireEvent.click(other);
    expect(other.checked).toBe(true);
    expect(myself.checked).toBe(false);
    expect(screen.getByText(/recipient’s contact and destination would be separate/)).toBeTruthy();
    fireEvent.click(myself);
    expect(screen.getByText(/recipient record would still be needed/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps all personal data fields disabled after changing the preview choice', () => {
    render(<RecipientLayoutPreview />);
    fireEvent.click(screen.getByRole('radio', { name: /Someone else/ }));
    expect((screen.getByLabelText('Recipient phone') as HTMLInputElement).matches(':disabled')).toBe(true);
    expect((screen.getByLabelText('Delivery address') as HTMLInputElement).matches(':disabled')).toBe(true);
  });
});
