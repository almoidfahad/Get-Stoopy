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
