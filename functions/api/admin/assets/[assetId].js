import { json, readJson, methodNotAllowed } from '../../../lib/http';
import { ALLOWED_ASSET_KINDS, ALLOWED_MIME_TYPES, parseBool } from '../../../lib/validators';
import { setProjectCoverAsset } from '../../../lib/db';

export async function onRequestPatch(context) {
  const body = await readJson(context.request);
  const assetId = context.params.assetId;

  const existing = await context.env.PORTFOLIO_DB.prepare('SELECT * FROM assets WHERE id = ?').bind(assetId).first();
  if (!existing) {
    return json({ error: 'Asset not found.' }, 404);
  }

  const kind = body.kind || existing.kind;
  const mimeType = body.mimeType || existing.mime_type;

  if (!ALLOWED_ASSET_KINDS.has(kind)) {
    return json({ error: 'Invalid asset kind.' }, 400);
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return json({ error: 'Unsupported MIME type.' }, 400);
  }

  const featured = body.featured === undefined ? Boolean(existing.featured) : parseBool(body.featured);

  await context.env.PORTFOLIO_DB.prepare(
    `UPDATE assets
     SET kind = ?,
         mime_type = ?,
         alt_text = ?,
         caption = ?,
         featured = ?,
         sort_order = ?,
         width = ?,
         height = ?
     WHERE id = ?`
  )
    .bind(
      kind,
      mimeType,
      body.altText ?? existing.alt_text,
      body.caption ?? existing.caption,
      featured ? 1 : 0,
      Number(body.sortOrder ?? existing.sort_order ?? 0),
      body.width ?? existing.width ?? null,
      body.height ?? existing.height ?? null,
      assetId
    )
    .run();

  if (featured) {
    await setProjectCoverAsset(context.env.PORTFOLIO_DB, existing.project_id, assetId);
  }

  return json({ ok: true, assetId });
}

export async function onRequest(context) {
  if (context.request.method === 'PATCH') return onRequestPatch(context);
  return methodNotAllowed(['PATCH']);
}
