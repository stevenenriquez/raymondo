import { requireAdmin } from '../lib/auth';

export async function onRequest(context) {
  const auth = requireAdmin(context.request, context.env);
  if (!auth.ok) {
    const host = new URL(context.request.url).hostname;
    const localHint =
      host === 'localhost' || host === '127.0.0.1'
        ? ' For local dev, run with ALLOW_LOCAL_ADMIN=true.'
        : '';
    return new Response(`Admin access required. Configure Cloudflare Access for /adminv2.${localHint}`, {
      status: 401,
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }

  return context.next();
}
