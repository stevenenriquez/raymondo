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

function fallbackCoverId(assetRows) {
  if (!assetRows || assetRows.length === 0) return null;
  const featured = assetRows.find((row) => Boolean(row.featured));
  return featured ? featured.id : assetRows[0].id;
}

export async function onRequestDelete(context) {
  const assetId = context.params.assetId;
  const db = context.env.PORTFOLIO_DB;
  const r2 = context.env.PORTFOLIO_R2;

  const existing = await db.prepare('SELECT * FROM assets WHERE id = ?').bind(assetId).first();
  if (!existing) {
    return json({ error: 'Asset not found.' }, 404);
  }

  await db.prepare('DELETE FROM assets WHERE id = ?').bind(assetId).run();

  const projectRow = await db
    .prepare('SELECT cover_asset_id FROM projects WHERE id = ?')
    .bind(existing.project_id)
    .first();

  const remainingAssets = await db
    .prepare(
      `SELECT id, featured
       FROM assets
       WHERE project_id = ?
       ORDER BY sort_order ASC, created_at ASC`
    )
    .bind(existing.project_id)
    .all();

  const remaining = remainingAssets.results || [];
  const remainingIds = new Set(remaining.map((row) => row.id));
  const currentCoverId = projectRow?.cover_asset_id || null;

  let nextCoverId = currentCoverId;
  if (!currentCoverId || !remainingIds.has(currentCoverId)) {
    nextCoverId = fallbackCoverId(remaining);
  }

  if (nextCoverId !== currentCoverId) {
    await setProjectCoverAsset(db, existing.project_id, nextCoverId);
  }

  let warning = null;
  if (r2 && existing.r2_key) {
    try {
      await r2.delete(existing.r2_key);
    } catch (error) {
      warning = String(error?.message || error || 'Asset was removed from DB but could not be deleted from R2.');
    }
  }

  return json({
    ok: true,
    assetId,
    projectId: existing.project_id,
    coverAssetId: nextCoverId,
    warning
  });
}

export async function onRequest(context) {
  if (context.request.method === 'PATCH') return onRequestPatch(context);
  if (context.request.method === 'DELETE') return onRequestDelete(context);
  return methodNotAllowed(['PATCH', 'DELETE']);
}
