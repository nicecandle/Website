// api/admin/content.js
// GET (public) : textes actuels de la page d'accueil.
// PUT (protégé par session admin) : mettre à jour un ou plusieurs textes.

const { sql } = require('../../lib/db');
const { parseCookies, isAdminSessionValid } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (req.method === 'GET') {
    try {
      const rows = await sql`SELECT key, value FROM site_content`;
      const content = {};
      rows.forEach(function (r) { content[r.key] = r.value; });
      res.status(200).json({ content: content });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur.' }); }
    return;
  }

  const cookies = parseCookies(req);
  const ok = await isAdminSessionValid(cookies.ic_admin_session);
  if (!ok) { res.status(401).json({ error: 'Non autorisé.' }); return; }

  if (req.method === 'PUT') {
    const updates = req.body || {};
    try {
      for (const key of Object.keys(updates)) {
        await sql`
          INSERT INTO site_content (key, value) VALUES (${key}, ${updates[key]})
          ON CONFLICT (key) DO UPDATE SET value = ${updates[key]}
        `;
      }
      res.status(200).json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur.' }); }
    return;
  }

  res.status(405).json({ error: 'Méthode non autorisée.' });
};
