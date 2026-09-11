// api/admin/carousel.js
// GET (public) : liste des diapositives.
// POST/DELETE (protégés par session admin) : ajouter / retirer une diapositive.
//
// Note sur les photos : ce endpoint accepte une image encodée en base64
// (photoUrl) et la stocke telle quelle dans la base. Ça fonctionne bien
// pour un volume modeste, mais pour beaucoup de photos ou des images
// lourdes, un service de stockage dédié (Vercel Blob, S3, Cloudinary)
// serait plus adapté — la base de données n'est pas faite pour ça à grande
// échelle. Remplaçable plus tard sans changer la structure du site.

const { sql } = require('../../lib/db');
const { parseCookies, isAdminSessionValid } = require('../../lib/auth');

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
      const rows = await sql`
        SELECT id, tag, title, description, color_slug, photo_url, link_href, link_label
        FROM site_carousel_slides ORDER BY sort_order ASC
      `;
      res.status(200).json({ slides: rows });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur.' }); }
    return;
  }

  if (!(await requireAdmin(req, res))) return;

  if (req.method === 'POST') {
    const { tag, title, description, colorSlug, photoUrl, linkHref, linkLabel } = req.body || {};
    if (!title) { res.status(400).json({ error: 'Titre requis.' }); return; }
    try {
      const maxOrder = await sql`SELECT COALESCE(MAX(sort_order), 0) as m FROM site_carousel_slides`;
      const rows = await sql`
        INSERT INTO site_carousel_slides (tag, title, description, color_slug, photo_url, link_href, link_label, sort_order)
        VALUES (${tag || null}, ${title}, ${description || null}, ${colorSlug || null}, ${photoUrl || null}, ${linkHref || null}, ${linkLabel || null}, ${maxOrder[0].m + 1})
        RETURNING id
      `;
      res.status(200).json({ ok: true, id: rows[0].id });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur.' }); }
    return;
  }

  if (req.method === 'DELETE') {
    const id = req.query && req.query.id;
    if (!id) { res.status(400).json({ error: 'id manquant.' }); return; }
    try {
      await sql`DELETE FROM site_carousel_slides WHERE id = ${id}`;
      res.status(200).json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur.' }); }
    return;
  }

  res.status(405).json({ error: 'Méthode non autorisée.' });
};
