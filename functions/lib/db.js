import { safeJsonParseArray } from './validators';

function mapProjectRow(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    discipline: row.discipline,
    coverAssetId: row.cover_asset_id,
    descriptionShort: row.description_short,
    descriptionLong: row.description_long,
    themeInspiration: row.theme_inspiration,
    styleDirection: row.style_direction,
    styleTemplate: row.style_template,
    typographyNotes: row.typography_notes,
    motifSummary: row.motif_summary,
    toolingNotes: row.tooling_notes,
    materialNotes: row.material_notes,
    palette: safeJsonParseArray(row.palette_json),
    tags: safeJsonParseArray(row.tags_json),
    status: row.status,
    publishedAt: row.published_at,
    sortOrder: Number(row.sort_order || 0),
    year: row.year,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAssetRow(row, publicAssetBaseUrl) {
  const key = String(row.r2_key);
  const safeKey = encodeURIComponent(key);

  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    r2Key: row.r2_key,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    altText: row.alt_text,
    caption: row.caption,
    featured: Boolean(row.featured),
    sortOrder: Number(row.sort_order || 0),
    url: publicAssetBaseUrl
      ? `${publicAssetBaseUrl}?key=${safeKey}`
      : `/api/assets?key=${safeKey}`
  };
}

export async function listProjects(db) {
  const { results } = await db
    .prepare(
      `SELECT id, slug, title, discipline, status, sort_order
       FROM projects
       ORDER BY sort_order ASC, updated_at DESC`
    )
    .all();

  return results.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    discipline: row.discipline,
    status: row.status,
    sortOrder: Number(row.sort_order || 0)
  }));
}

export async function getProjectById(db, id, publicAssetBaseUrl) {
  const row = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  if (!row) return null;

  const assetRows = await db
    .prepare(
      `SELECT *
       FROM assets
       WHERE project_id = ?
       ORDER BY sort_order ASC, created_at ASC`
    )
    .bind(id)
    .all();

  return {
    ...mapProjectRow(row),
    assets: assetRows.results.map((asset) => mapAssetRow(asset, publicAssetBaseUrl))
  };
}

export async function upsertProject(db, payload) {
  const id = payload.id || crypto.randomUUID();
  const now = new Date().toISOString();

  const existing = await db.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();

  const values = [
    id,
    payload.slug,
    payload.title,
    payload.discipline,
    payload.coverAssetId || null,
    payload.descriptionShort || '',
    payload.descriptionLong || '',
    payload.themeInspiration || '',
    payload.styleDirection || '',
    payload.styleTemplate || 'editorial',
    payload.typographyNotes || '',
    payload.motifSummary || '',
    payload.toolingNotes || '',
    payload.materialNotes || '',
    JSON.stringify(payload.palette || []),
    JSON.stringify(payload.tags || []),
    payload.status || 'draft',
    payload.status === 'published' ? now : null,
    Number(payload.sortOrder || 0),
    payload.year ?? null,
    now,
    now
  ];

  if (existing) {
    await db
      .prepare(
        `UPDATE projects
         SET slug = ?,
             title = ?,
             discipline = ?,
             cover_asset_id = ?,
             description_short = ?,
             description_long = ?,
             theme_inspiration = ?,
             style_direction = ?,
             style_template = ?,
             typography_notes = ?,
             motif_summary = ?,
             tooling_notes = ?,
             material_notes = ?,
             palette_json = ?,
             tags_json = ?,
             status = ?,
             published_at = ?,
             sort_order = ?,
             year = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .bind(
        payload.slug,
        payload.title,
        payload.discipline,
        payload.coverAssetId || null,
        payload.descriptionShort || '',
        payload.descriptionLong || '',
        payload.themeInspiration || '',
        payload.styleDirection || '',
        payload.styleTemplate || 'editorial',
        payload.typographyNotes || '',
        payload.motifSummary || '',
        payload.toolingNotes || '',
        payload.materialNotes || '',
        JSON.stringify(payload.palette || []),
        JSON.stringify(payload.tags || []),
        payload.status || 'draft',
        payload.status === 'published' ? now : null,
        Number(payload.sortOrder || 0),
        payload.year ?? null,
        now,
        id
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO projects (
          id, slug, title, discipline, cover_asset_id,
          description_short, description_long, theme_inspiration, style_direction, style_template,
          typography_notes, motif_summary, tooling_notes, material_notes,
          palette_json, tags_json, status, published_at,
          sort_order, year, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(...values)
      .run();
  }

  return id;
}

export async function attachAsset(db, payload) {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO assets (
        id, project_id, kind, r2_key, mime_type, width, height,
        alt_text, caption, featured, sort_order, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      payload.projectId,
      payload.kind,
      payload.r2Key,
      payload.mimeType,
      payload.width ?? null,
      payload.height ?? null,
      payload.altText || '',
      payload.caption || '',
      payload.featured ? 1 : 0,
      Number(payload.sortOrder || 0),
      new Date().toISOString()
    )
    .run();

  return id;
}

export async function setProjectCoverAsset(db, projectId, coverAssetId) {
  await db
    .prepare('UPDATE projects SET cover_asset_id = ?, updated_at = ? WHERE id = ?')
    .bind(coverAssetId, new Date().toISOString(), projectId)
    .run();
}

export async function listPublishedProjectsWithAssets(db, publicAssetBaseUrl) {
  const projects = await db
    .prepare(
      `SELECT *
       FROM projects
       WHERE status = 'published'
       ORDER BY sort_order ASC, updated_at DESC`
    )
    .all();

  const projectRows = projects.results || [];
  if (projectRows.length === 0) return [];

  const ids = projectRows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const assets = await db
    .prepare(
      `SELECT *
       FROM assets
       WHERE project_id IN (${placeholders})
       ORDER BY sort_order ASC, created_at ASC`
    )
    .bind(...ids)
    .all();

  const assetsByProject = new Map();
  for (const row of assets.results || []) {
    const mapped = mapAssetRow(row, publicAssetBaseUrl);
    const list = assetsByProject.get(row.project_id) || [];
    list.push(mapped);
    assetsByProject.set(row.project_id, list);
  }

  return projectRows.map((row) => ({
    ...mapProjectRow(row),
    assets: assetsByProject.get(row.id) || []
  }));
}
