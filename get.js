// api/orders/get.js
//
// Utilisé par le site juste après le retour du visiteur depuis la page de
// paiement Stripe, pour vérifier que la commande a bien été marquée "paid"
// par le webhook (voir stripe-webhook.js). Protégé par session : un client
// ne peut consulter que ses propres commandes (les identifiants de commande
// sont séquentiels, donc devinables — sans cette vérification, n'importe
// qui pourrait consulter les commandes des autres).

const { sql } = require('../../lib/db');
const { parseCookies, getCustomerFromSession } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method !== 'GET') { res.status(405).json({ error: 'Méthode non autorisée.' }); return; }

  const cookies = parseCookies(req);
  const customer = await getCustomerFromSession(cookies.ic_session);
  if (!customer) { res.status(401).json({ error: 'Non connecté.' }); return; }

  const orderId = req.query && req.query.id;
  if (!orderId) { res.status(400).json({ error: 'id manquant.' }); return; }

  try {
    const rows = await sql`SELECT id, status, total_amount, created_at, customer_id FROM orders WHERE id = ${orderId}`;
    const order = rows[0];
    if (!order || order.customer_id !== customer.id) { res.status(404).json({ error: 'Commande introuvable.' }); return; }
    res.status(200).json({ id: order.id, status: order.status, total: Number(order.total_amount), date: order.created_at });
  } catch (err) {
    console.error('orders/get error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
