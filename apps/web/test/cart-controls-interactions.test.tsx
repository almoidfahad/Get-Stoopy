// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { AddToCart, CartLineControls } from '../src/components/cart-controls';

const variants = [{ id: 'one', label: 'Small', priceLabel: 'BDT 12.00' }, { id: 'two', label: 'Large', priceLabel: 'BDT 14.00' }];
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('cart controls interactions', () => {
  it.each(['', '0', '101', '-1', '1.5', 'abc'])('blocks invalid quantity %s rather than silently changing it', value => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    render(<AddToCart variants={variants} signedIn />);
    const input = screen.getByLabelText('Quantity') as HTMLInputElement;
    fireEvent.change(input, { target: { value } });
    expect(input.value).toBe(value);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Enter a whole number between 1 and 100.')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Add to cart' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('requires an explicit option and shows its actual price before adding', () => {
    render(<AddToCart variants={variants} signedIn />);
    const select = screen.getByLabelText('Option') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect((screen.getByRole('button', { name: 'Add to cart' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('option', { name: 'Small — BDT 12.00 each' })).toBeTruthy();
    fireEvent.change(select, { target: { value: 'two' } });
    expect(screen.getByText(/Selected:/).textContent).toContain('Large · BDT 14.00 each');
    expect((screen.getByRole('button', { name: 'Add to cart' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('asks for a choice even when only one option can be ordered', () => {
    render(<AddToCart variants={[variants[0]!]} signedIn />);
    expect((screen.getByLabelText('Option') as HTMLSelectElement).value).toBe('');
    expect((screen.getByRole('button', { name: 'Add to cart' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Option'), { target: { value: 'one' } });
    expect(screen.getByText(/Selected:/).textContent).toContain('Small · BDT 12.00 each');
  });
  it('updates the displayed price if the selected option refreshes', () => {
    const { rerender } = render(<AddToCart variants={variants} signedIn />);
    fireEvent.change(screen.getByLabelText('Option'), { target: { value: 'one' } });
    rerender(<AddToCart variants={[{ ...variants[0]!, priceLabel: 'BDT 15.00' }, variants[1]!]} signedIn />);
    expect(screen.getByText(/Selected:/).textContent).toContain('BDT 15.00 each');
    expect(screen.getByText(/does not reserve stock/)).toBeTruthy();
  });
  it('submits the chosen option and quantity and clears success when the entry changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetchMock);
    render(<AddToCart variants={variants} signedIn />);
    fireEvent.change(screen.getByLabelText('Option'), { target: { value: 'two' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Added.'));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ variantId: 'two', quantity: 100 });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } });
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('requires an explicit new selection when a selected option disappears', () => {
    const { rerender } = render(<AddToCart variants={variants} signedIn />);
    fireEvent.change(screen.getByLabelText('Option'), { target: { value: 'two' } });
    rerender(<AddToCart variants={[variants[0]!]} signedIn />);
    const select = screen.getByLabelText('Option') as HTMLSelectElement;
    const button = screen.getByRole('button', { name: 'Add to cart' }) as HTMLButtonElement;
    expect(select.value).toBe('');
    expect(button.disabled).toBe(true);
    fireEvent.change(select, { target: { value: 'one' } });
    expect(button.disabled).toBe(false);
  });
  it('does not restore a vanished choice that later reappears', () => {
    const { rerender } = render(<AddToCart variants={variants} signedIn />);
    fireEvent.change(screen.getByLabelText('Option'), { target: { value: 'two' } });
    rerender(<AddToCart variants={[variants[0]!]} signedIn />);
    rerender(<AddToCart variants={variants} signedIn />);
    expect((screen.getByLabelText('Option') as HTMLSelectElement).value).toBe('');
    expect((screen.getByRole('button', { name: 'Add to cart' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('disables inputs during an in-flight request and avoids duplicate posts', async () => {
    let finish!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetchMock);
    render(<AddToCart variants={variants} signedIn />);
    fireEvent.change(screen.getByLabelText('Option'), { target: { value: 'one' } });
    const button = screen.getByRole('button', { name: 'Add to cart' });
    fireEvent.click(button); fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Quantity') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Option') as HTMLSelectElement).disabled).toBe(true);
    finish(new Response('{}', { status: 200 }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });
  it('suggests checking the cart after an ambiguous network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<AddToCart variants={variants} signedIn />);
    fireEvent.change(screen.getByLabelText('Option'), { target: { value: 'one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Check your cart before trying again');
  });
  it('refreshes on a conflicting cart edit without retrying the update', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'CART_VERSION_CONFLICT' }), { status: 409 })); vi.stubGlobal('fetch', fetchMock);
    render(<CartLineControls variantId="one" productTitle="Item" quantity={2} version={7} />);
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity for Item' }));
    expect((await screen.findByRole('alert')).textContent).toContain('changed in another tab');
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ variantId: 'one', quantity: 3, expectedVersion: 7 });
  });
});
