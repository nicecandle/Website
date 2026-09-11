// api/site-data.js
//
// Appelé par index.html au chargement de la page pour récupérer les
// teintes, le carrousel et les textes actuellement en base — c'est-à-dire
// ce que remplace ce fichier : l'ancien système où les modifications faites
// depuis l'administration n'étaient visibles que dans le navigateur de la
// personne qui les avait faites (localStorage). Avec cet endpoint, tous les
// visiteurs voient les mêmes données, à jour.
//
// Public — aucune authentification nécessaire, ces informations sont déjà
// affichées publiquement sur le site.

const { sql } = require('../lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  if (req.method !== 'GET') { res.status(405).json({ error: 'Méthode non autorisée.' }); return; }

  try {
    const colorsRows = await sql`SELECT slug as id, name, hex, fill, stroke, opacity FROM site_colors ORDER BY sort_order ASC`;
    const slidesRows = await sql`
      SELECT tag, title, description, color_slug, photo_url, link_href, link_label
      FROM site_carousel_slides ORDER BY sort_order ASC
    `;
    const slides = slidesRows.map(function (s) {
      var slide = { tag: s.tag, title: s.title, desc: s.description };
      if (s.photo_url) slide.photoSrc = s.photo_url;
      else if (s.color_slug) slide.colorId = s.color_slug;
      if (s.link_href) slide.link = { href: s.link_href, label: s.link_label || 'En savoir plus ↗' };
      return slide;
    });
    const contentRows = await sql`SELECT key, value FROM site_content`;
    const content = {};
    contentRows.forEach(function (r) { content[r.key] = r.value; });

    res.status(200).json({ colors: colorsRows, carousel: slides, content: content });
  } catch (err) {
    console.error('site-data error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
