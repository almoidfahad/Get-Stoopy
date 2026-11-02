import { describe, expect, it } from 'vitest';
import { assertMagicContentType, detectMagicContentType } from '../src/content-type';

describe('storage magic-byte validation', () => {
  it('detects allowlisted binary signatures', () => {
    expect(detectMagicContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe('image/png');
    expect(detectMagicContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectMagicContentType(Buffer.from('RIFF0000WEBP', 'ascii'))).toBe('image/webp');
    expect(detectMagicContentType(Buffer.from('%PDF-1.7 fake'))).toBe('application/pdf');
  });
  it('rejects mismatched or active content', () => {
    expect(() => assertMagicContentType(Buffer.from('<html></html>'), 'application/pdf')).toThrow('STORAGE_CONTENT_TYPE_MISMATCH');
    expect(() => assertMagicContentType(Buffer.from('%PDF-1.4'), 'image/png')).toThrow('STORAGE_CONTENT_TYPE_MISMATCH');
    expect(detectMagicContentType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectMagicContentType(Buffer.alloc(0))).toBeNull();
  });
});
