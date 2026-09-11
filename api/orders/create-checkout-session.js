// api/orders/create-checkout-session.js
//
// Remplace l'ancienne version : crée d'abord la commande dans la base de
// données (statut "pending"), puis la session de paiement Stripe qui y
// fait référence (via metadata.order_id). Le webhook Stripe passera la
// commande à "paid" une fois le paiement confirmé — voir stripe-webhook.js.

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { sql } = require('../../lib/db');
const { parseCookies, getCustomerFromSession } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Méthode non autorisée.' }); return; }

  if (!process.env.STRIPE_SECRET_KEY) {
    res.status(500).json({ error: 'STRIPE_SECRET_KEY manquant côté serveur.' });
    return;
  }

  const cookies = parseCookies(req);
  const customer = await getCustomerFromSession(cookies.ic_session);
  if (!customer) { res.status(401).json({ error: 'Connectez-vous pour finaliser votre commande.' }); return; }

  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) { res.status(400).json({ error: 'Panier vide ou invalide.' }); return; }

  try {
    var total = 0;
    items.forEach(function (i) { total += Number(i.unitPrice) * Number(i.qty); });

    const orderRows = await sql`
      INSERT INTO orders (customer_id, status, total_amount)
      VALUES (${customer.id}, 'pending', ${total})
      RETURNING id
    `;
    const orderId = orderRows[0].id;

    for (const item of items) {
      await sql`
        INSERT INTO order_items
          (order_id, color_name, color_hex, color_fill, color_stroke, engraved_text, motif_description, unit_price, quantity, engraving_file)
        VALUES
          (${orderId}, ${item.colorName || 'Personnalisé'}, ${item.colorHex || null}, ${item.colorFill || null}, ${item.colorStroke || null},
           ${item.text || null}, ${item.motifDesc || null}, ${item.unitPrice}, ${Math.max(1, Math.min(20, Number(item.qty) || 1))},
           ${item.engravingFile || null})
      `;
    }

    const line_items = items.map(function (item) {
      var descriptionParts = [];
      if (item.text) descriptionParts.push('Gravure : « ' + item.text + ' »');
      if (item.motifDesc) descriptionParts.push(item.motifDesc);
      return {
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'Photophore Ice Candle — ' + (item.colorName || 'Personnalisé'),
            description: descriptionParts.join(' · ') || undefined
          },
          unit_amount: Math.round(Number(item.unitPrice) * 100)
        },
        quantity: Math.max(1, Math.min(20, Number(item.qty) || 1))
      };
    });

    const origin = req.headers.origin || ('https://' + req.headers.host);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: line_items,
      customer_email: customer.email,
      success_url: origin + '/?checkout=success&order_id=' + orderId,
      cancel_url: origin + '/?checkout=cancelled',
      shipping_address_collection: { allowed_countries: ['FR', 'BE', 'CH', 'MC', 'LU'] },
      metadata: { order_id: String(orderId) }
    });

    await sql`UPDATE orders SET stripe_session_id = ${session.id} WHERE id = ${orderId}`;

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    res.status(500).json({ error: 'Erreur lors de la création du paiement.' });
  }
};
