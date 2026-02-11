ALTER TABLE site_settings ADD COLUMN home_footer_text TEXT NOT NULL DEFAULT '';

UPDATE site_settings
SET home_footer_text = 'Available for identity, visual systems, and 3D direction work.\nraymondartguy@gmail.com'
WHERE id = 1 AND TRIM(home_footer_text) = '';
