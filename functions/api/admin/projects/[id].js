import { getProjectById } from '../../../lib/db';
import { json, methodNotAllowed } from '../../../lib/http';

export async function onRequestGet(context) {
  const project = await getProjectById(
    context.env.PORTFOLIO_DB,
    context.params.id,
    context.env.ASSET_PUBLIC_BASE_URL
  );

  if (!project) {
    return json({ error: 'Project not found.' }, 404);
  }

  return json({ project });
}

export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  return methodNotAllowed(['GET']);
}
