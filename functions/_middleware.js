import { requireAdmin } from './lib/auth';

export async function onRequest(context) {
  const path = new URL(context.request.url).pathname;
  if (path.startsWith('/api/admin/')) {
    const auth = requireAdmin(context.request, context.env);
    if (!auth.ok) return auth.response;
  }

  return context.next();
}
