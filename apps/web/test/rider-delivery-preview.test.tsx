// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RiderDeliveryPreview } from '../src/components/rider-delivery-preview';
import DeliveryPreviewPage from '../src/app/rider/delivery-preview/page';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('rider delivery layout preview', () => {
  it('states that no live delivery is loaded and disables offer actions', () => {
    render(<DeliveryPreviewPage />);
    expect(screen.getByText(/Layout preview only — not a delivery tool/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Accept offer' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Decline offer' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/No real offer or countdown is shown here/)).toBeTruthy();
  });
  it('switches layout states without network calls or real actions', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    render(<RiderDeliveryPreview />);
    fireEvent.click(screen.getByRole('radio', { name: 'Pickup & route' }));
    expect(screen.getByRole('heading', { name: 'Pickup & route layout' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Confirm pickup' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Open navigation' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Delivery proof' }));
    expect((screen.getByLabelText('Recipient verification code') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Confirm delivery' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
