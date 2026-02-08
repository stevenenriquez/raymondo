import { json } from './http';

function isLocalhost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function getAdminEmail(request, env) {
  const email = request.headers.get('CF-Access-Authenticated-User-Email');
  if (email) return email;

  const devHeader = request.headers.get('x-admin-email');
  const host = new URL(request.url).hostname;
  const allowLocal =
    String(env.ALLOW_LOCAL_ADMIN || 'false').toLowerCase() === 'true' ||
    String(env.ALLOW_ADMIN_LOCAL || 'false').toLowerCase() === 'true';

  if (allowLocal && isLocalhost(host)) {
    return devHeader || 'local-admin@localhost';
  }

  return null;
}

export function requireAdmin(request, env) {
  const email = getAdminEmail(request, env);
  if (!email) {
    return {
      ok: false,
      response: json(
        {
          error:
            'Admin access denied. Configure Cloudflare Access and include CF-Access-Authenticated-User-Email.'
        },
        401
      )
    };
  }

  return { ok: true, email };
}
