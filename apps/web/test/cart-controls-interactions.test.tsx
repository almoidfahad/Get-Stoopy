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
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('requires an explicit option and shows its actual price before adding', () => {
    render(<AddToCart variants={variants} signedIn />);
    const select = screen.getByLabelText('Option') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(screen.getByRole('button', { name: 'Add to cart' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('option', { name: 'Small — BDT 12.00 each' })).toBeTruthy();
    fireEvent.change(select, { target: { value: 'two' } });
    expect(screen.getByText(/Selected:/).textContent).toContain('Large · BDT 14.00 each');
    expect(screen.getByRole('button', { name: 'Add to cart' }).getAttribute('aria-disabled')).toBe('false');
  });
  it('asks for a choice even when only one option can be ordered', () => {
    render(<AddToCart variants={[variants[0]!]} signedIn />);
    expect((screen.getByLabelText('Option') as HTMLSelectElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Add to cart' }).getAttribute('aria-disabled')).toBe('true');
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
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(select, { target: { value: 'one' } });
    expect(button.getAttribute('aria-disabled')).toBe('false');
  });
  it('does not restore a vanished choice that later reappears', () => {
    const { rerender } = render(<AddToCart variants={variants} signedIn />);
    fireEvent.change(screen.getByLabelText('Option'), { target: { value: 'two' } });
    rerender(<AddToCart variants={[variants[0]!]} signedIn />);
    rerender(<AddToCart variants={variants} signedIn />);
    expect((screen.getByLabelText('Option') as HTMLSelectElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Add to cart' }).getAttribute('aria-disabled')).toBe('true');
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
  it('preserves button focus during a pending request and an uncertain outcome without allowing another add', async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AddToCart variants={variants} signedIn />);
    const button = screen.getByRole('button', { name: 'Add to cart' });
    button.focus();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Option'), { target: { value: 'one' } });
    fireEvent.click(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(new Response('{}', { status: 503 }));
    await screen.findByRole('alert');
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const description = button.getAttribute('aria-describedby');
    expect(description && document.getElementById(description)?.textContent).toContain('Check your cart');
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(['network', 'server'] as const)('requires acknowledgement after an ambiguous %s add outcome', async failure => {
    const fetchMock = failure === 'network' ? vi.fn().mockRejectedValue(new Error('offline')) : vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AddToCart variants={variants} signedIn />);
    fireEvent.change(screen.getByLabelText('Option'), { target: { value: 'one' } });
    const button = screen.getByRole('button', { name: 'Add to cart' }) as HTMLButtonElement;
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toContain('result is unknown');
    expect(screen.getByRole('link', { name: 'View cart' }).getAttribute('href')).toBe('/cart');
    expect(screen.getByText(/reload cannot guarantee/)).toBeTruthy();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const acknowledge = screen.getByRole('button', { name: 'I understand, enable adding again' });
    acknowledge.focus();
    fireEvent.click(acknowledge);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('does not mark an explicit rejected request as an unknown outcome', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'CART_VARIANT_NOT_SELLABLE' }), { status: 409 })));
    render(<AddToCart variants={variants} signedIn />);
    fireEvent.change(screen.getByLabelText('Option'), { target: { value: 'one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    expect((await screen.findByRole('alert')).textContent).toContain('no longer available');
    expect(screen.queryByRole('button', { name: 'I understand, enable adding again' })).toBeNull();
  });
  it('offers a cart reload and disables that line after an uncertain update', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', fetchMock);
    render(<CartLineControls variantId="one" productTitle="Item" quantity={2} version={7} />);
    const increase = screen.getByRole('button', { name: 'Increase quantity for Item' }) as HTMLButtonElement;
    fireEvent.click(increase);
    expect((await screen.findByRole('alert')).textContent).toContain('result is unknown');
    expect(increase.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Remove Item from cart' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('link', { name: 'Reload cart' }).getAttribute('href')).toBe('/cart');
    expect(screen.getByText(/earlier request may still complete later/)).toBeTruthy();
    fireEvent.click(increase);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('retains focus while an update is pending, blocks repeat actions, and keeps focus after an explicit failure', async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CartLineControls variantId="one" productTitle="Item" quantity={2} version={7} />);
    const increase = screen.getByRole('button', { name: 'Increase quantity for Item' });
    increase.focus();
    fireEvent.click(increase);
    expect(document.activeElement).toBe(increase);
    expect(increase.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Updating cart');
    fireEvent.click(increase);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Item from cart' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(new Response(JSON.stringify({ code: 'CART_QUANTITY_LIMIT' }), { status: 400 }));
    await screen.findByRole('alert');
    expect(document.activeElement).toBe(increase);
    expect(increase.getAttribute('aria-disabled')).toBe('false');
  });
  it.each([[1, 'Decrease quantity for Item'], [100, 'Increase quantity for Item']] as const)('blocks a quantity outside limits even though the control remains focusable', (quantity, name) => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    render(<CartLineControls variantId="one" productTitle="Item" quantity={quantity} version={7} />);
    const button = screen.getByRole('button', { name });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
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
