// api/admin/order-status.js
//
// POST (protégé par session admin) : fait passer une commande payée à
// « en préparation » ou « expédiée », et prévient le client par e-mail.
// Les statuts 'pending' et 'paid' restent entièrement gérés par Stripe/le
// webhook — cet endpoint ne peut avancer une commande que vers les deux
// statuts suivants du cycle.

const { sql } = require('../../lib/db');
const { parseCookies, isAdminSessionValid } = require('../../lib/auth');
const { sendEmail, escapeHtml, customerEmailWrapper } = require('../../lib/email');

const ALLOWED_STATUSES = ['preparing', 'shipped'];
const STATUS_LABELS_FR = { preparing: 'en cours de préparation', shipped: 'expédiée' };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Méthode non autorisée.' }); return; }

  const cookies = parseCookies(req);
  const ok = await isAdminSessionValid(cookies.ic_admin_session);
  if (!ok) { res.status(401).json({ error: 'Non autorisé.' }); return; }

  const { orderId, status, trackingNumber } = req.body || {};
  if (!orderId || ALLOWED_STATUSES.indexOf(status) === -1) {
    res.status(400).json({ error: 'Paramètres invalides.' });
    return;
  }

  try {
    const rows = await sql`
      SELECT o.id, o.status AS current_status, c.email AS customer_email
      FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE o.id = ${orderId}
    `;
    if (rows.length === 0) { res.status(404).json({ error: 'Commande introuvable.' }); return; }
    const order = rows[0];

    if (status === 'shipped' && trackingNumber) {
      await sql`UPDATE orders SET status = ${status}, tracking_number = ${trackingNumber} WHERE id = ${orderId}`;
    } else {
      await sql`UPDATE orders SET status = ${status} WHERE id = ${orderId}`;
    }

    const trackingLine = (status === 'shipped' && trackingNumber)
      ? '<p>Numéro de suivi : <strong>' + escapeHtml(trackingNumber) + '</strong></p>'
      : '';
    const html = customerEmailWrapper(
      '<p>Votre commande <strong>#' + order.id + '</strong> est ' + STATUS_LABELS_FR[status] + '.</p>' +
      trackingLine
    );
    await sendEmail({
      to: order.customer_email,
      subject: 'Commande #' + order.id + ' — ' + STATUS_LABELS_FR[status],
      html: html
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Erreur order-status', orderId, err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
