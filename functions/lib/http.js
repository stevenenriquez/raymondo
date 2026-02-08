export function json(data, init = 200) {
  const status = typeof init === 'number' ? init : init.status || 200;
  const headers = new Headers(typeof init === 'number' ? undefined : init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}

export async function readJson(request) {
  const text = await request.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Response(JSON.stringify({ error: 'Request body must be valid JSON.' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
}

export function methodNotAllowed(allowedMethods) {
  return json({ error: `Method not allowed. Use: ${allowedMethods.join(', ')}` }, 405);
}
