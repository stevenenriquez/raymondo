import { json, readJson, methodNotAllowed } from '../../lib/http';
import { signValue } from '../../lib/signing';
import { ALLOWED_MIME_TYPES, normalizeMimeType, sanitizeFilename } from '../../lib/validators';

export async function onRequestPost(context) {
  const body = await readJson(context.request);
  const filename = sanitizeFilename(body.filename || 'file');
  const mimeType = normalizeMimeType(filename, body.mimeType);

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return json({ error: 'Unsupported file type.' }, 400);
  }

  const allowedModel = mimeType.startsWith('model/') || filename.endsWith('.glb') || filename.endsWith('.gltf');
  const allowedImage = mimeType.startsWith('image/');

  if (!allowedModel && !allowedImage) {
    return json({ error: 'Only image and GLB/GLTF files are allowed.' }, 400);
  }

  const projectPrefix = body.projectId ? String(body.projectId) : 'unassigned';
  const id = crypto.randomUUID();
  // Keep key as a single segment so Pages dynamic route `[key].js` resolves reliably.
  const r2Key = `${projectPrefix}--${id}-${filename}`;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expires = nowSeconds + 10 * 60;
  const base = `${r2Key}:${mimeType}:${expires}`;

  const secret = context.env.UPLOAD_SIGNING_SECRET;
  if (!secret) {
    return json({ error: 'UPLOAD_SIGNING_SECRET is not configured.' }, 500);
  }

  const signature = await signValue(secret, base);
  const url = new URL(context.request.url);
  const uploadUrl = `${url.origin}/api/admin/upload?key=${encodeURIComponent(
    r2Key
  )}&mimeType=${encodeURIComponent(mimeType)}&expires=${expires}&signature=${signature}`;

  return json({ uploadUrl, r2Key, mimeType, expires });
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return methodNotAllowed(['POST']);
}
