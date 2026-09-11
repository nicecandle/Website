// api/auth/signup.js
const { sql } = require('../../lib/db');
const { hashPassword, createSession, setSessionCookie, SESSION_DURATION_MS } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Méthode non autorisée.' }); return; }

  const { email, password } = req.body || {};
  if (!email || !password || String(password).length < 6) {
    res.status(400).json({ error: 'E-mail et mot de passe (6 caractères minimum) requis.' });
    return;
  }
  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    const existing = await sql`SELECT id FROM customers WHERE email = ${normalizedEmail}`;
    if (existing.length > 0) {
      res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail.' });
      return;
    }
    const passwordHash = await hashPassword(password);
    const rows = await sql`
      INSERT INTO customers (email, password_hash) VALUES (${normalizedEmail}, ${passwordHash})
      RETURNING id, email
    `;
    const customer = rows[0];
    const session = await createSession(customer.id);
    setSessionCookie(res, 'ic_session', session.token, SESSION_DURATION_MS);
    res.status(200).json({ email: customer.email });
  } catch (err) {
    console.error('signup error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
