// api/admin/logout.js
const { parseCookies, destroyAdminSession, clearSessionCookie } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Méthode non autorisée.' }); return; }

  const cookies = parseCookies(req);
  await destroyAdminSession(cookies.ic_admin_session);
  clearSessionCookie(res, 'ic_admin_session');
  res.status(200).json({ ok: true });
};
