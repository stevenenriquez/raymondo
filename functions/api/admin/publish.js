import { buildPublishedCatalog } from '../../lib/catalog';
import { json, readJson, methodNotAllowed } from '../../lib/http';

export async function onRequestPost(context) {
  const requestBody = await readJson(context.request);
  const dryRun = requestBody?.dryRun === true;
  const { errors, readinessByProject, snapshot } = await buildPublishedCatalog(context.env);

  if (dryRun) {
    return json({
      ok: errors.length === 0,
      dryRun: true,
      projectCount: snapshot.projects.length,
      errors,
      readiness: readinessByProject
    });
  }

  if (errors.length > 0) {
    return json({ error: 'Publish validation failed.', errors, readiness: readinessByProject }, 422);
  }

  const snapshotBody = JSON.stringify(snapshot, null, 2);
  const key = 'published/catalog.json';
  await context.env.PORTFOLIO_R2.put(key, snapshotBody, {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8'
    }
  });

  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const historyKey = `published/history/catalog-${timestamp}.json`;
  await context.env.PORTFOLIO_R2.put(historyKey, snapshotBody, {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8'
    }
  });

  const email = context.request.headers.get('CF-Access-Authenticated-User-Email') || 'unknown';
  await context.env.PORTFOLIO_DB.prepare(
    `INSERT INTO publish_snapshots (snapshot_key, project_count, created_at, triggered_by, errors_json)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(key, snapshot.projects.length, new Date().toISOString(), email, '[]')
    .run();

  const warnings = [];
  let deployTriggered = false;
  const deployHook = context.env.PAGES_DEPLOY_HOOK_URL;

  if (deployHook) {
    try {
      const deployResponse = await fetch(deployHook, { method: 'POST' });
      if (!deployResponse.ok) {
        warnings.push(`Deploy hook returned ${deployResponse.status}.`);
      } else {
        deployTriggered = true;
      }
    } catch (error) {
      warnings.push(`Deploy hook error: ${String(error?.message || error)}`);
    }
  } else {
    warnings.push('PAGES_DEPLOY_HOOK_URL is not configured. Snapshot saved without triggering deploy.');
  }

  return json({
    ok: true,
    projectCount: snapshot.projects.length,
    snapshotKey: key,
    historyKey,
    deployTriggered,
    warnings,
    readiness: readinessByProject
  });
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return methodNotAllowed(['POST']);
}
