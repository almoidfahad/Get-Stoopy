// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminReviewPreview } from '../src/components/admin-review-preview';
import ReviewPreviewPage from '../src/app/admin/review-preview/page';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('admin review layout preview', () => {
  it('states that no access is verified and disables review controls', () => {
    render(<ReviewPreviewPage />);
    expect(screen.getByText(/Layout preview only — not an admin tool/)).toBeTruthy();
    expect(screen.getByText(/does not check or grant admin permissions/)).toBeTruthy();
    expect((screen.getByLabelText('Decision reason') as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/not an empty queue/)).toBeTruthy();
  });
  it('switches between product and identity layouts without fetching private data', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    render(<AdminReviewPreview />);
    fireEvent.click(screen.getByRole('radio', { name: 'Identity review' }));
    expect(screen.getByRole('heading', { name: 'Identity review layout' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
