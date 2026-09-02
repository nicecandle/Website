-- ============================================================
-- Ice Candle Cannes — schéma de base de données (PostgreSQL)
-- ============================================================
-- À exécuter une fois sur votre base (voir la note de déploiement
-- qui accompagne ces fichiers pour la marche à suivre avec Neon).
-- Peut être relancé sans risque (IF NOT EXISTS / ON CONFLICT partout).

CREATE TABLE IF NOT EXISTS customers (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sessions clients : jeton opaque envoyé au navigateur via cookie httpOnly
-- (donc invisible et inaccessible en JavaScript côté client — contrairement
-- à l'ancien système en localStorage, ceci protège contre le vol de session
-- par une faille XSS, et fonctionne sur tous les appareils du client).
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Sessions administrateur (même principe, un seul compte admin partagé —
-- voir ADMIN_PASSWORD dans les variables d'environnement).
CREATE TABLE IF NOT EXISTS admin_sessions (
  token      TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id                SERIAL PRIMARY KEY,
  customer_id       INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  stripe_session_id TEXT UNIQUE,
  status            TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'paid' | 'cancelled'
  total_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id                SERIAL PRIMARY KEY,
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  color_name        TEXT NOT NULL,
  color_hex         TEXT,
  color_fill        TEXT,
  color_stroke      TEXT,
  engraved_text     TEXT,
  motif_description TEXT,
  unit_price        NUMERIC(10,2) NOT NULL,
  quantity          INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ---------- Contenu du site géré depuis l'administration ----------
-- Remplace l'ancien système où ces réglages vivaient dans le localStorage
-- du navigateur (donc invisibles pour vos vrais visiteurs).

CREATE TABLE IF NOT EXISTS site_colors (
  id         SERIAL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  hex        TEXT NOT NULL,
  fill       TEXT NOT NULL,
  stroke     TEXT NOT NULL,
  opacity    NUMERIC(3,2) NOT NULL DEFAULT 0.6,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS site_carousel_slides (
  id          SERIAL PRIMARY KEY,
  tag         TEXT,
  title       TEXT NOT NULL,
  description TEXT,
  color_slug  TEXT REFERENCES site_colors(slug) ON DELETE SET NULL,
  photo_url   TEXT,
  link_href   TEXT,
  link_label  TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS site_content (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ============================================================
-- Données de départ (identiques aux valeurs par défaut du site)
-- ============================================================

INSERT INTO site_colors (slug, name, hex, fill, stroke, opacity, sort_order) VALUES
  ('cristal', 'Cristal',     '#EAF3FA', 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0.45)', 0.32, 1),
  ('ambre',   'Ambre',       '#C98A46', '#C98A46', '#8f5f2c', 0.62, 2),
  ('sauge',   'Vert Sauge',  '#8FA88C', '#8FA88C', '#5f7a5d', 0.60, 3),
  ('nuit',    'Bleu Nuit',   '#435A75', '#435A75', '#2c3d50', 0.66, 4),
  ('poudre',  'Rose Poudré', '#D9AFAF', '#D9AFAF', '#a97e7e', 0.56, 5),
  ('fume',    'Noir Fumé',   '#2B2E33', '#2B2E33', '#101214', 0.78, 6)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO site_carousel_slides (tag, title, description, color_slug, sort_order) VALUES
  ('Nouveauté', 'Nouvelle teinte : Vert Sauge', 'Une teinte inédite rejoint la collection, en édition limitée.', 'sauge', 1),
  ('Le concept', 'Rechargeable à vie', 'Rapportez votre verre en atelier pour une recharge de cire, autant de fois que vous le voulez.', 'cristal', 2),
  ('Collection Fêtes', 'Éditions dorées', 'Teintes et parfums d''hiver, disponibles jusqu''à épuisement des stocks.', 'ambre', 3),
  ('Fabrication', 'Soufflé et gravé à Cannes', 'Chaque verre est façonné à la main, à quelques pas de Grasse, capitale mondiale du parfum.', 'fume', 4)
ON CONFLICT DO NOTHING;

INSERT INTO site_carousel_slides (tag, title, description, link_href, link_label, sort_order) VALUES
  ('Coulisses', 'Suivez l''atelier', 'Nouveautés et inspirations en coulisses sur notre Instagram.', 'https://www.instagram.com/ice_candle_cannes/', '@ice_candle_cannes ↗', 5)
ON CONFLICT DO NOTHING;

INSERT INTO site_content (key, value) VALUES
  ('heroEyebrow', 'Atelier de gravure sur verre — Cannes'),
  ('heroH1Line1', 'Un verre. Une flamme.'),
  ('heroH1Em', 'Votre empreinte.'),
  ('heroParagraph', 'Chaque bougie Ice Candle est un verre soufflé, teinté à la main, puis gravé au laser avec votre texte et votre motif — et pensé pour être rechargé à vie. Composez la vôtre ci-dessous, et faites-la tourner sous tous les angles.'),
  ('specChip1', 'Format unique — 9 × 8 cm'),
  ('specChip2', 'Rechargeable à vie'),
  ('specChip3', 'Cire 100% végétale'),
  ('specChip4', 'Couvercle métal anti-vent'),
  ('processStep1Title', 'Le verre soufflé'),
  ('processStep1Desc', 'Chaque contenant est soufflé et teinté à la main. Aucune bulle, aucun reflet ne se répète jamais tout à fait.'),
  ('processStep2Title', 'La gravure'),
  ('processStep2Desc', 'Votre texte et votre motif sont vectorisés puis gravés au laser, trait par trait, à même le verre froid.'),
  ('processStep3Title', 'La cire, à vie'),
  ('processStep3Desc', 'Une cire 100% végétale et parfumée est coulée dans le verre gravé, mèche centrée. Le contenant se garde : rapportez-le en atelier pour une recharge, aussi souvent que vous le voulez.')
ON CONFLICT (key) DO NOTHING;
