// api/admin/colors.js
// GET (public) : liste des teintes, pour l'écran de gestion.
// POST/DELETE (protégés par session admin) : ajouter / retirer une teinte.

const { sql } = require('../../lib/db');
const { parseCookies, isAdminSessionValid } = require('../../lib/auth');

function slugify(s) {
  var base = String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return base || 'teinte';
}

function deriveColorMeta(hex) {
  var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
  var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  var sr = Math.round(r * 0.6), sg = Math.round(g * 0.6), sb = Math.round(b * 0.6);
  var stroke = '#' + [sr, sg, sb].map(function (v) { var h = v.toString(16); return h.length < 2 ? '0' + h : h; }).join('');
  var opacity = Math.max(0.32, Math.min(0.8, Math.round((0.85 - lum * 0.5) * 100) / 100));
  return { stroke: stroke, opacity: opacity };
}

async function requireAdmin(req, res) {
  const cookies = parseCookies(req);
  const ok = await isAdminSessionValid(cookies.ic_admin_session);
  if (!ok) { res.status(401).json({ error: 'Non autorisé.' }); return false; }
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (req.method === 'GET') {
    try {
      const colors = await sql`SELECT slug as id, name, hex, fill, stroke, opacity FROM site_colors ORDER BY sort_order ASC`;
      res.status(200).json({ colors: colors });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur.' }); }
    return;
  }

  if (!(await requireAdmin(req, res))) return;

  if (req.method === 'POST') {
    const { name, hex } = req.body || {};
    if (!name || !/^#[0-9a-fA-F]{6}$/.test(hex || '')) {
      res.status(400).json({ error: 'Nom ou couleur invalide.' });
      return;
    }
    try {
      const existing = await sql`SELECT slug FROM site_colors`;
      var existingSlugs = existing.map(function (r) { return r.slug; });
      var baseSlug = slugify(name), slug = baseSlug, n = 2;
      while (existingSlugs.indexOf(slug) !== -1) { slug = baseSlug + '-' + n; n++; }
      const meta = deriveColorMeta(hex);
      const maxOrder = await sql`SELECT COALESCE(MAX(sort_order), 0) as m FROM site_colors`;
      await sql`
        INSERT INTO site_colors (slug, name, hex, fill, stroke, opacity, sort_order)
        VALUES (${slug}, ${name}, ${hex}, ${hex}, ${meta.stroke}, ${meta.opacity}, ${maxOrder[0].m + 1})
      `;
      res.status(200).json({ ok: true, slug: slug });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur.' }); }
    return;
  }

  if (req.method === 'DELETE') {
    const slug = req.query && req.query.slug;
    if (!slug) { res.status(400).json({ error: 'slug manquant.' }); return; }
    try {
      const count = await sql`SELECT COUNT(*) as c FROM site_colors`;
      if (Number(count[0].c) <= 1) { res.status(400).json({ error: 'Impossible de supprimer la dernière teinte.' }); return; }
      await sql`DELETE FROM site_colors WHERE slug = ${slug}`;
      res.status(200).json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur.' }); }
    return;
  }

  res.status(405).json({ error: 'Méthode non autorisée.' });
};
