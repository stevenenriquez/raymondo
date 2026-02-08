export async function onRequestGet(context) {
  const key = context.params.key;
  if (!key) {
    return new Response('Asset key is required.', { status: 400 });
  }

  const object = await context.env.PORTFOLIO_R2.get(decodeURIComponent(key));
  if (!object) {
    return new Response('Asset not found.', { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=86400');

  return new Response(object.body, { headers });
}
