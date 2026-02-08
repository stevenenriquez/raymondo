PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  discipline TEXT NOT NULL CHECK (discipline IN ('graphic', '3d')),
  cover_asset_id TEXT,
  description_short TEXT NOT NULL DEFAULT '',
  description_long TEXT NOT NULL DEFAULT '',
  theme_inspiration TEXT NOT NULL DEFAULT '',
  style_direction TEXT NOT NULL DEFAULT '',
  style_template TEXT NOT NULL DEFAULT 'editorial',
  typography_notes TEXT NOT NULL DEFAULT '',
  motif_summary TEXT NOT NULL DEFAULT '',
  tooling_notes TEXT NOT NULL DEFAULT '',
  material_notes TEXT NOT NULL DEFAULT '',
  palette_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  year INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'model3d', 'poster')),
  r2_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  alt_text TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS publish_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_key TEXT NOT NULL,
  project_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  errors_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_projects_status_sort ON projects(status, sort_order);
CREATE INDEX IF NOT EXISTS idx_assets_project_sort ON assets(project_id, sort_order);
