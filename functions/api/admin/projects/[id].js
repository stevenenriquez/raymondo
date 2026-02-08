import { deleteDraftProject, getProjectById } from '../../../lib/db';
import { json, methodNotAllowed } from '../../../lib/http';
import { computeProjectReadiness } from '../../../lib/catalog';

export async function onRequestGet(context) {
  const project = await getProjectById(
    context.env.PORTFOLIO_DB,
    context.params.id,
    context.env.ASSET_PUBLIC_BASE_URL
  );

  if (!project) {
    return json({ error: 'Project not found.' }, 404);
  }

  return json({
    project: {
      ...project,
      readiness: computeProjectReadiness(project)
    }
  });
}

export async function onRequestDelete(context) {
  const deleted = await deleteDraftProject(context.env.PORTFOLIO_DB, context.params.id, context.env.PORTFOLIO_R2);

  if (!deleted.ok && deleted.reason === 'not_found') {
    return json({ error: 'Project not found.' }, 404);
  }

  if (!deleted.ok && deleted.reason === 'not_draft') {
    return json({ error: 'Only draft projects can be deleted.' }, 409);
  }

  return json({
    ok: true,
    projectId: context.params.id,
    deletedAssetCount: deleted.deletedAssetCount,
    warning: deleted.r2DeleteError || null
  });
}

export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'DELETE') return onRequestDelete(context);
  return methodNotAllowed(['GET', 'DELETE']);
}
