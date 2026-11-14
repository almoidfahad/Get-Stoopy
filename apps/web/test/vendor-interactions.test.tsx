// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProductPreviewEditor } from '../src/components/product-preview-editor';
import { StockCalculator } from '../src/components/stock-calculator';

afterEach(cleanup);

describe('vendor preview interactions', () => {
  it('updates the product layout using typed information without a submit action', () => {
    const { container } = render(<ProductPreviewEditor />);
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Sample name' } });
    fireEvent.change(screen.getByLabelText('Brand (optional)'), { target: { value: 'Sample brand' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Sample description' } });
    const preview = screen.getByRole('region', { name: 'Layout preview' });
    expect(within(preview).getByText('Sample name')).toBeTruthy();
    expect(within(preview).getByText('Sample brand')).toBeTruthy();
    expect(within(preview).getByText('Sample description')).toBeTruthy();
    expect(container.querySelector('form')).toBeNull();
  });
  it('clears both entries and validation and returns focus to the first field', () => {
    render(<StockCalculator />);
    const onHand = screen.getByLabelText('On-hand units') as HTMLInputElement;
    const reserved = screen.getByLabelText('Reserved units') as HTMLInputElement;
    const clear = screen.getByRole('button', { name: 'Clear calculation' }) as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
    fireEvent.change(onHand, { target: { value: '2' } });
    fireEvent.change(reserved, { target: { value: '3' } });
    expect(reserved.getAttribute('aria-invalid')).toBe('true');
    expect(clear.disabled).toBe(false);
    fireEvent.click(clear);
    expect(onHand.value).toBe('');
    expect(reserved.value).toBe('');
    expect(reserved.hasAttribute('aria-invalid')).toBe(false);
    expect(screen.getByText('Enter both quantities to calculate.')).toBeTruthy();
    expect(clear.disabled).toBe(true);
    expect(document.activeElement).toBe(onHand);
  });
  it('calculates, displays validation errors and returns to the incomplete state', () => {
    render(<StockCalculator />);
    const onHand = screen.getByLabelText('On-hand units');
    const reserved = screen.getByLabelText('Reserved units');
    fireEvent.change(onHand, { target: { value: '10' } });
    fireEvent.change(reserved, { target: { value: '3' } });
    expect(screen.getByText('7')).toBeTruthy();
    fireEvent.change(reserved, { target: { value: '11' } });
    expect(reserved.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Reserved units cannot exceed on-hand units.')).toBeTruthy();
    expect(screen.queryByText('7')).toBeNull();
    fireEvent.change(reserved, { target: { value: '' } });
    expect(reserved.hasAttribute('aria-invalid')).toBe(false);
    expect(screen.getByText('Enter both quantities to calculate.')).toBeTruthy();
  });
});
