import { listProjects, upsertProject, getProjectById } from '../../../lib/db';
import { json, readJson, methodNotAllowed } from '../../../lib/http';
import { computeProjectReadiness } from '../../../lib/catalog';
import {
  ALLOWED_DISCIPLINES,
  ALLOWED_STATUS,
  ALLOWED_STYLE_TEMPLATES,
  parseArray
} from '../../../lib/validators';

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildFallbackSlug(seedTitle = '') {
  const base = slugify(seedTitle) || 'untitled-project';
  return `${base}-${Date.now().toString(36)}`;
}

function validateProjectInput(body) {
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

function normalizeProject(body, existingProject) {
  const hasTitle = Object.prototype.hasOwnProperty.call(body, 'title');
  const requestedTitle = String(body.title ?? '').trim();
  const title = hasTitle ? requestedTitle : String(existingProject?.title ?? '').trim();

  const requestedSlug = String(body.slug ?? '').trim();
  const slug = requestedSlug || existingProject?.slug || buildFallbackSlug(title);

  return {
    id: body.id,
    slug,
    title,
    discipline: body.discipline || existingProject?.discipline || 'graphic',
    coverAssetId: body.coverAssetId ?? existingProject?.coverAssetId ?? null,
    descriptionShort: String(body.descriptionShort ?? existingProject?.descriptionShort ?? ''),
    descriptionLong: String(body.descriptionLong ?? existingProject?.descriptionLong ?? ''),
    themeInspiration: String(body.themeInspiration ?? existingProject?.themeInspiration ?? ''),
    styleDirection: String(body.styleDirection ?? existingProject?.styleDirection ?? ''),
    styleTemplate: body.styleTemplate || existingProject?.styleTemplate || 'editorial',
    typographyNotes: String(body.typographyNotes ?? existingProject?.typographyNotes ?? ''),
    motifSummary: String(body.motifSummary ?? existingProject?.motifSummary ?? ''),
    toolingNotes: String(body.toolingNotes ?? existingProject?.toolingNotes ?? ''),
    materialNotes: String(body.materialNotes ?? existingProject?.materialNotes ?? ''),
    palette: body.palette === undefined ? existingProject?.palette || [] : parseArray(body.palette),
    tags: body.tags === undefined ? existingProject?.tags || [] : parseArray(body.tags),
    status: body.status || existingProject?.status || 'draft',
    year:
      body.year === undefined
        ? existingProject?.year ?? null
        : typeof body.year === 'number'
          ? body.year
          : body.year
            ? Number(body.year)
            : null,
    sortOrder: body.sortOrder === undefined ? Number(existingProject?.sortOrder || 0) : Number(body.sortOrder || 0)
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

  const existingProject = body.id
    ? await getProjectById(context.env.PORTFOLIO_DB, body.id, context.env.ASSET_PUBLIC_BASE_URL)
    : null;

  const payload = normalizeProject(body, existingProject);

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
