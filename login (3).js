// api/auth/login.js
const { sql } = require('../../lib/db');
const { verifyPassword, createSession, setSessionCookie, SESSION_DURATION_MS } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Méthode non autorisée.' }); return; }

  const { email, password } = req.body || {};
  if (!email || !password) { res.status(400).json({ error: 'E-mail et mot de passe requis.' }); return; }
  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    const rows = await sql`SELECT id, email, password_hash FROM customers WHERE email = ${normalizedEmail}`;
    const customer = rows[0];
    if (!customer) { res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' }); return; }

    const valid = await verifyPassword(password, customer.password_hash);
    if (!valid) { res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' }); return; }

    const session = await createSession(customer.id);
    setSessionCookie(res, 'ic_session', session.token, SESSION_DURATION_MS);
    res.status(200).json({ email: customer.email });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
