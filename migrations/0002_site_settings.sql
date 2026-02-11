CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  home_hero_title TEXT NOT NULL DEFAULT '',
  home_hero_subtitle TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

INSERT INTO site_settings (id, home_hero_title, home_hero_subtitle, updated_at)
VALUES (
  1,
  'Graphic Design and 3D Worlds',
  'Raymondo builds identities, editorial systems, and 3D forms with a tactile visual language. Each project page includes theme inspiration, design DNA, and process cues.',
  CURRENT_TIMESTAMP
)
ON CONFLICT(id) DO NOTHING;
