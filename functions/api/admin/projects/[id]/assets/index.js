import { attachAsset, getProjectById, setProjectCoverAsset } from '../../../../../lib/db';
import { json, readJson, methodNotAllowed } from '../../../../../lib/http';
import { ALLOWED_ASSET_KINDS, ALLOWED_MIME_TYPES, parseBool } from '../../../../../lib/validators';

export async function onRequestPost(context) {
  const body = await readJson(context.request);

  if (!body.r2Key || !body.mimeType || !body.kind) {
    return json({ error: 'r2Key, mimeType, and kind are required.' }, 400);
  }

  if (!ALLOWED_ASSET_KINDS.has(body.kind)) {
    return json({ error: 'Invalid asset kind.' }, 400);
  }

  if (!ALLOWED_MIME_TYPES.has(body.mimeType)) {
    return json({ error: 'Unsupported MIME type.' }, 400);
  }

  const project = await getProjectById(
    context.env.PORTFOLIO_DB,
    context.params.id,
    context.env.ASSET_PUBLIC_BASE_URL
  );

  if (!project) {
    return json({ error: 'Project not found.' }, 404);
  }

  const payload = {
    projectId: context.params.id,
    kind: body.kind,
    r2Key: body.r2Key,
    mimeType: body.mimeType,
    width: body.width ?? null,
    height: body.height ?? null,
    altText: body.altText || '',
    caption: body.caption || '',
    featured: parseBool(body.featured),
    sortOrder: Number(body.sortOrder || 0)
  };

  const assetId = await attachAsset(context.env.PORTFOLIO_DB, payload);

  if (payload.featured || !project.coverAssetId) {
    await setProjectCoverAsset(context.env.PORTFOLIO_DB, context.params.id, assetId);
  }

  const updated = await getProjectById(
    context.env.PORTFOLIO_DB,
    context.params.id,
    context.env.ASSET_PUBLIC_BASE_URL
  );

  return json({ project: updated, assetId });
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return methodNotAllowed(['POST']);
}
