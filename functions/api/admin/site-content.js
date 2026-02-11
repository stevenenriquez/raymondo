import { getSiteContent, upsertSiteContent } from '../../lib/db';
import { json, methodNotAllowed, readJson } from '../../lib/http';

export async function onRequestGet(context) {
  const site = await getSiteContent(context.env.PORTFOLIO_DB);
  return json({ site });
}

export async function onRequestPost(context) {
  const body = await readJson(context.request);
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body || {}, 'heroTitle')) {
    patch.heroTitle = body.heroTitle;
  }
  if (Object.prototype.hasOwnProperty.call(body || {}, 'heroSubtitle')) {
    patch.heroSubtitle = body.heroSubtitle;
  }
  if (Object.prototype.hasOwnProperty.call(body || {}, 'footerText')) {
    patch.footerText = body.footerText;
  }

  const site = await upsertSiteContent(context.env.PORTFOLIO_DB, patch);
  return json({ site, autosave: body?.autosave === true });
}

export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'POST') return onRequestPost(context);
  return methodNotAllowed(['GET', 'POST']);
}
