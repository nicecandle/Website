// api/admin/login.js
//
// Vérifie le mot de passe administrateur côté serveur, contre la variable
// d'environnement ADMIN_PASSWORD (jamais exposée au navigateur). C'est ce
// qui corrige la faille de l'ancienne page d'administration : avant, le mot
// de passe était vérifié entièrement en JavaScript côté client, donc
// n'importe qui pouvait la contourner via les outils de développement.
// Maintenant, toutes les routes /api/admin/* exigent une session valide
// vérifiée ici — impossible à contourner depuis le navigateur.

const { createAdminSession, setSessionCookie, SESSION_DURATION_MS } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Méthode non autorisée.' }); return; }

  if (!process.env.ADMIN_PASSWORD) {
    res.status(500).json({ error: 'ADMIN_PASSWORD non configuré côté serveur.' });
    return;
  }

  const { password } = req.body || {};
  if (password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Mot de passe incorrect.' });
    return;
  }

  const session = await createAdminSession();
  setSessionCookie(res, 'ic_admin_session', session.token, SESSION_DURATION_MS);
  res.status(200).json({ ok: true });
};
