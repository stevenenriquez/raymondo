export const ALLOWED_DISCIPLINES = new Set(['graphic', '3d']);
export const ALLOWED_STATUS = new Set(['draft', 'published']);
export const ALLOWED_STYLE_TEMPLATES = new Set(['editorial', 'brutalist', 'minimal-grid']);
export const ALLOWED_ASSET_KINDS = new Set(['image', 'model3d', 'poster']);

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'model/gltf-binary',
  'model/gltf+json',
  'application/octet-stream'
]);

export function parseArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

export function safeJsonParseArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseBool(value) {
  return value === true || value === 'true' || value === 1;
}

export function sanitizeFilename(filename) {
  const cleaned = String(filename || 'file')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-');
  return cleaned.slice(0, 140);
}

export function normalizeMimeType(filename, mimeType) {
  if (mimeType && ALLOWED_MIME_TYPES.has(mimeType)) {
    return mimeType;
  }

  const name = String(filename || '').toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.avif')) return 'image/avif';
  if (name.endsWith('.glb')) return 'model/gltf-binary';
  if (name.endsWith('.gltf')) return 'model/gltf+json';
  return 'application/octet-stream';
}
