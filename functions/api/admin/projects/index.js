import { listProjects, upsertProject, getProjectById } from '../../../lib/db';
import { json, readJson, methodNotAllowed } from '../../../lib/http';
import { computeProjectReadiness } from '../../../lib/catalog';
import {
  ALLOWED_DISCIPLINES,
  ALLOWED_STATUS,
  ALLOWED_STYLE_TEMPLATES,
  parseArray
} from '../../../lib/validators';

function validateProjectInput(body) {
  if (!body.slug || !body.title) {
    return 'slug and title are required.';
  }

  if (!ALLOWED_DISCIPLINES.has(body.discipline || 'graphic')) {
    return 'discipline must be graphic or 3d.';
  }

  if (!ALLOWED_STATUS.has(body.status || 'draft')) {
    return 'status must be draft or published.';
  }

  if (!ALLOWED_STYLE_TEMPLATES.has(body.styleTemplate || 'editorial')) {
    return 'styleTemplate must be editorial, brutalist, or minimal-grid.';
  }

  return null;
}

function normalizeProject(body) {
  return {
    id: body.id,
    slug: String(body.slug || '').trim(),
    title: String(body.title || '').trim(),
    discipline: body.discipline || 'graphic',
    coverAssetId: body.coverAssetId || null,
    descriptionShort: String(body.descriptionShort || ''),
    descriptionLong: String(body.descriptionLong || ''),
    themeInspiration: String(body.themeInspiration || ''),
    styleDirection: String(body.styleDirection || ''),
    styleTemplate: body.styleTemplate || 'editorial',
    typographyNotes: String(body.typographyNotes || ''),
    motifSummary: String(body.motifSummary || ''),
    toolingNotes: String(body.toolingNotes || ''),
    materialNotes: String(body.materialNotes || ''),
    palette: parseArray(body.palette),
    tags: parseArray(body.tags),
    status: body.status || 'draft',
    year: typeof body.year === 'number' ? body.year : body.year ? Number(body.year) : null,
    sortOrder: Number(body.sortOrder || 0)
  };
}

export async function onRequestGet(context) {
  const projects = await listProjects(context.env.PORTFOLIO_DB);
  const projectsWithReadiness = await Promise.all(
    projects.map(async (project) => {
      const detailed = await getProjectById(context.env.PORTFOLIO_DB, project.id, context.env.ASSET_PUBLIC_BASE_URL);
      const readiness = detailed
        ? computeProjectReadiness(detailed)
        : { canPublish: false, hardMissing: ['Project data unavailable.'], softMissing: [], discipline: project.discipline };

      return {
        ...project,
        readiness
      };
    })
  );

  return json({ projects: projectsWithReadiness });
}

export async function onRequestPost(context) {
  const body = await readJson(context.request);
  const error = validateProjectInput(body);
  if (error) {
    return json({ error }, 400);
  }

  const payload = normalizeProject(body);

  try {
    const id = await upsertProject(context.env.PORTFOLIO_DB, payload);
    const project = await getProjectById(context.env.PORTFOLIO_DB, id, context.env.ASSET_PUBLIC_BASE_URL);
    if (!project) {
      return json({ error: 'Saved project could not be loaded.' }, 500);
    }

    const readiness = computeProjectReadiness(project);
    return json({ project: { ...project, readiness }, autosave: body?.autosave === true }, 200);
  } catch (dbError) {
    const message = String(dbError?.message || 'Failed to save project.');
    if (message.includes('UNIQUE constraint failed: projects.slug')) {
      return json({ error: 'A project with that slug already exists.' }, 409);
    }

    return json({ error: message }, 500);
  }
}

export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'POST') return onRequestPost(context);
  return methodNotAllowed(['GET', 'POST']);
}
