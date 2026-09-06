// lib/auth.js
//
// Mots de passe et sessions.
//
// - Les mots de passe clients sont hachés avec bcrypt avant stockage
//   (jamais en clair — contrairement à l'ancienne version en localStorage).
// - Les sessions sont des jetons aléatoires opaques stockés en base
//   (donc révocables : la déconnexion les supprime réellement), transmis
//   au navigateur via un cookie httpOnly — invisible et inaccessible en
//   JavaScript côté client, ce qui protège contre le vol de session par une
//   faille XSS (contrairement à un jeton stocké dans localStorage).
// - Le mot de passe administrateur est comparé côté serveur à la variable
//   d'environnement ADMIN_PASSWORD, jamais exposée au navigateur — c'est ce
//   qui corrige la faille de l'ancienne page d'administration (dont le
//   contrôle se faisait entièrement en JavaScript côté client, donc
//   contournable par n'importe qui via les outils de développement).

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sql } = require('./db');

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// ---------- Sessions clients ----------

async function createSession(customerId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await sql`INSERT INTO sessions (token, customer_id, expires_at) VALUES (${token}, ${customerId}, ${expiresAt})`;
  return { token, expiresAt };
}

async function getCustomerFromSession(token) {
  if (!token) return null;
  const rows = await sql`
    SELECT c.id, c.email FROM sessions s
    JOIN customers c ON c.id = s.customer_id
    WHERE s.token = ${token} AND s.expires_at > now()
  `;
  return rows[0] || null;
}

async function destroySession(token) {
  if (!token) return;
  await sql`DELETE FROM sessions WHERE token = ${token}`;
}

// ---------- Sessions admin ----------

async function createAdminSession() {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await sql`INSERT INTO admin_sessions (token, expires_at) VALUES (${token}, ${expiresAt})`;
  return { token, expiresAt };
}

async function isAdminSessionValid(token) {
  if (!token) return false;
  const rows = await sql`SELECT 1 FROM admin_sessions WHERE token = ${token} AND expires_at > now()`;
  return rows.length > 0;
}

async function destroyAdminSession(token) {
  if (!token) return;
  await sql`DELETE FROM admin_sessions WHERE token = ${token}`;
}

// ---------- Cookies ----------

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(function (pair) {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setSessionCookie(res, name, token, maxAgeMs) {
  const isProd = process.env.NODE_ENV === 'production';
  var cookie = name + '=' + encodeURIComponent(token) +
    '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(maxAgeMs / 1000);
  if (isProd) cookie += '; Secure';
  res.setHeader('Set-Cookie', cookie);
}

function clearSessionCookie(res, name) {
  res.setHeader('Set-Cookie', name + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

module.exports = {
  SESSION_DURATION_MS,
  hashPassword,
  verifyPassword,
  createSession,
  getCustomerFromSession,
  destroySession,
  createAdminSession,
  isAdminSessionValid,
  destroyAdminSession,
  parseCookies,
  setSessionCookie,
  clearSessionCookie
};
