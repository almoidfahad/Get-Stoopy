export type AllowedStorageContentType = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = Buffer.from('%PDF-');

export function detectMagicContentType(data: Buffer): AllowedStorageContentType | null {
  if (data.length >= PNG.length && data.subarray(0, PNG.length).equals(PNG)) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (data.length >= PDF.length && data.subarray(0, PDF.length).equals(PDF)) return 'application/pdf';
  return null;
}

export function assertMagicContentType(data: Buffer, declared: string): AllowedStorageContentType {
  const detected = detectMagicContentType(data);
  if (!detected || detected !== declared) throw new Error('STORAGE_CONTENT_TYPE_MISMATCH');
  return detected;
}
