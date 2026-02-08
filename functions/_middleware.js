import { requireAdmin } from './lib/auth';

export async function onRequest(context) {
  const path = new URL(context.request.url).pathname;
  const method = context.request.method.toUpperCase();

  // Signed upload URLs are short-lived and HMAC-verified in the handler.
  // Cloudflare Access may not inject CF-Access-Authenticated-User-Email on PUT.
  if (path === '/api/admin/upload' && (method === 'PUT' || method === 'OPTIONS')) {
    return context.next();
  }

  if (path.startsWith('/api/admin/')) {
    const auth = requireAdmin(context.request, context.env);
    if (!auth.ok) return auth.response;
  }

  return context.next();
}
