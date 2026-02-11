import { safeJsonParseArray } from './validators';

const DEFAULT_SITE_CONTENT = {
  heroTitle: 'Graphic Design and 3D Worlds',
  heroSubtitle:
    'Raymondo builds identities, editorial systems, and 3D forms with a tactile visual language. Each project page includes theme inspiration, design DNA, and process cues.',
  footerText: 'Available for identity, visual systems, and 3D direction work.\nraymondartguy@gmail.com'
};

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
    url: publicAssetBaseUrl ? `${publicAssetBaseUrl}/${safeKey}` : `/api/files/${safeKey}`
  };
}

function mapSiteContentRow(row) {
  return {
    heroTitle: String(row?.home_hero_title ?? DEFAULT_SITE_CONTENT.heroTitle),
    heroSubtitle: String(row?.home_hero_subtitle ?? DEFAULT_SITE_CONTENT.heroSubtitle),
    footerText: String(row?.home_footer_text ?? DEFAULT_SITE_CONTENT.footerText)
  };
}

async function ensureSiteContentRow(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS site_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        home_hero_title TEXT NOT NULL DEFAULT '',
        home_hero_subtitle TEXT NOT NULL DEFAULT '',
        home_footer_text TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )`
    )
    .run();

  const columns = await db.prepare('PRAGMA table_info(site_settings)').all();
  const hasFooterTextColumn = Array.isArray(columns?.results)
    ? columns.results.some((column) => column?.name === 'home_footer_text')
    : false;

  if (!hasFooterTextColumn) {
    await db
      .prepare("ALTER TABLE site_settings ADD COLUMN home_footer_text TEXT NOT NULL DEFAULT ''")
      .run();
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO site_settings (id, home_hero_title, home_hero_subtitle, home_footer_text, updated_at)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    )
    .bind(
      DEFAULT_SITE_CONTENT.heroTitle,
      DEFAULT_SITE_CONTENT.heroSubtitle,
      DEFAULT_SITE_CONTENT.footerText,
      now
    )
    .run();
}

export async function getSiteContent(db) {
  await ensureSiteContentRow(db);
  const row = await db
    .prepare('SELECT home_hero_title, home_hero_subtitle, home_footer_text FROM site_settings WHERE id = 1')
    .first();
  return mapSiteContentRow(row);
}

export async function upsertSiteContent(db, payload) {
  const current = await getSiteContent(db);
  const next = {
    heroTitle:
      payload && Object.prototype.hasOwnProperty.call(payload, 'heroTitle')
        ? String(payload.heroTitle ?? '')
        : current.heroTitle,
    heroSubtitle:
      payload && Object.prototype.hasOwnProperty.call(payload, 'heroSubtitle')
        ? String(payload.heroSubtitle ?? '')
        : current.heroSubtitle,
    footerText:
      payload && Object.prototype.hasOwnProperty.call(payload, 'footerText')
        ? String(payload.footerText ?? '')
        : current.footerText
  };

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO site_settings (id, home_hero_title, home_hero_subtitle, home_footer_text, updated_at)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         home_hero_title = excluded.home_hero_title,
         home_hero_subtitle = excluded.home_hero_subtitle,
         home_footer_text = excluded.home_footer_text,
         updated_at = excluded.updated_at`
    )
    .bind(next.heroTitle, next.heroSubtitle, next.footerText, now)
    .run();

  return next;
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

export async function deleteDraftProject(db, projectId, r2Bucket) {
  const existing = await db.prepare('SELECT id, status FROM projects WHERE id = ?').bind(projectId).first();
  if (!existing) {
    return { ok: false, reason: 'not_found' };
  }

  if (existing.status !== 'draft') {
    return { ok: false, reason: 'not_draft' };
  }

  const assetRows = await db.prepare('SELECT r2_key FROM assets WHERE project_id = ?').bind(projectId).all();
  const keys = (assetRows.results || []).map((row) => row.r2_key).filter(Boolean);

  let r2DeleteError = null;
  if (r2Bucket && keys.length > 0) {
    try {
      await r2Bucket.delete(keys);
    } catch (error) {
      r2DeleteError = String(error?.message || error || 'Failed to delete one or more objects from R2.');
    }
  }

  await db.prepare('DELETE FROM projects WHERE id = ?').bind(projectId).run();

  return {
    ok: true,
    deletedAssetCount: keys.length,
    r2DeleteError
  };
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
