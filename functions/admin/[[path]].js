import { requireAdmin } from '../lib/auth';

export async function onRequest(context) {
  const auth = requireAdmin(context.request, context.env);
  if (!auth.ok) {
    return new Response('Admin access required. Configure Cloudflare Access for /admin.', {
      status: 401,
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }

  return context.next();
}
