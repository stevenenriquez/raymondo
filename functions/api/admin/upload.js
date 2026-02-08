import { json, methodNotAllowed } from '../../lib/http';
import { signValue, safeEqual } from '../../lib/signing';

export async function onRequestPut(context) {
  const secret = context.env.UPLOAD_SIGNING_SECRET;
  if (!secret) {
    return json({ error: 'UPLOAD_SIGNING_SECRET is not configured.' }, 500);
  }

  const url = new URL(context.request.url);
  const key = url.searchParams.get('key');
  const mimeType = url.searchParams.get('mimeType');
  const expires = url.searchParams.get('expires');
  const signature = url.searchParams.get('signature');

  if (!key || !mimeType || !expires || !signature) {
    return json({ error: 'Missing upload signature query parameters.' }, 400);
  }

  const expiresNum = Number(expires);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(expiresNum) || now > expiresNum) {
    return json({ error: 'Upload URL has expired.' }, 401);
  }

  const expectedSignature = await signValue(secret, `${key}:${mimeType}:${expires}`);
  if (!safeEqual(signature, expectedSignature)) {
    return json({ error: 'Invalid upload signature.' }, 401);
  }

  const uploadMimeType = context.request.headers.get('content-type') || mimeType;
  await context.env.PORTFOLIO_R2.put(key, context.request.body, {
    httpMetadata: {
      contentType: uploadMimeType
    }
  });

  return json({ ok: true, key });
}

export async function onRequest(context) {
  if (context.request.method === 'PUT') return onRequestPut(context);
  return methodNotAllowed(['PUT']);
}
