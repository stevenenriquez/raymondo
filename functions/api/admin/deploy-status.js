import { buildPublishedCatalog } from '../../lib/catalog';
import { json, methodNotAllowed } from '../../lib/http';

function projectsSignature(snapshot) {
  return JSON.stringify(Array.isArray(snapshot?.projects) ? snapshot.projects : []);
}

export async function onRequestGet(context) {
  const { snapshot: currentSnapshot } = await buildPublishedCatalog(context.env);
  const currentSignature = projectsSignature(currentSnapshot);

  let deployedSnapshot = null;
  let warning = null;

  try {
    const object = await context.env.PORTFOLIO_R2.get('published/catalog.json');
    if (object) {
      const text = await object.text();
      deployedSnapshot = text ? JSON.parse(text) : null;
    }
  } catch (error) {
    warning = `Could not load deployed snapshot: ${String(error?.message || error)}`;
  }

  const hasDeployedSnapshot = Boolean(deployedSnapshot);
  const deployedSignature = projectsSignature(deployedSnapshot);
  const hasPendingChanges = hasDeployedSnapshot
    ? deployedSignature !== currentSignature
    : (currentSnapshot.projects?.length || 0) > 0;

  return json({
    ok: true,
    hasPendingChanges,
    hasDeployedSnapshot,
    publishedProjectCount: currentSnapshot.projects?.length || 0,
    warning
  });
}

export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  return methodNotAllowed(['GET']);
}
