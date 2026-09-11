// api/orders/create-checkout-session.js
//
// Crée la commande dans la base (statut "pending"), puis la session de
// paiement Stripe qui y fait référence (via metadata.order_id). Le webhook
// Stripe passera la commande à "paid" une fois le paiement confirmé — voir
// stripe-webhook.js.
//
// IMPORTANT — sécurité des prix et promotions :
// Le prix unitaire, les frais de livraison et l'état des promotions sont
// TOUJOURS relus depuis la base de données ici, jamais depuis ce que le
// navigateur envoie. Un visiteur qui modifierait la requête depuis les
// outils de développement (prix à 0€, promotion inexistante activée...) n'a
// aucune prise sur le montant réellement facturé : seul l'admin, via la
// page d'administration, peut changer ces valeurs.

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
    // ---------- 1. Réglages authentiques (prix, livraison, promotions) ----------
    const settingsRows = await sql`
      SELECT key, value FROM site_content
      WHERE key IN ('basePrice', 'shippingFee', 'promo1Active', 'promo2Active', 'promo3Active')
    `;
    const settings = {};
    settingsRows.forEach(function (r) { settings[r.key] = r.value; });

    const basePrice = Number(settings.basePrice) > 0 ? Number(settings.basePrice) : 34.00;
    const shippingFee = Number(settings.shippingFee) >= 0 ? Number(settings.shippingFee) : 5.99;
    const promo1Active = settings.promo1Active === 'true';
    const promo2Active = settings.promo2Active === 'true';
    const promo3Active = settings.promo3Active === 'true';

    // ---------- 2. Quantités et sous-total, à partir du panier reçu mais du PRIX SERVEUR ----------
    var totalQty = 0;
    items.forEach(function (i) { totalQty += Math.max(1, Math.min(20, Number(i.qty) || 1)); });
    const subtotal = totalQty * basePrice;

    // ---------- 3. Promotions (cumulables) ----------
    const promo1Discount = promo1Active ? subtotal * 0.20 : 0;
    const freeUnits = promo3Active ? Math.floor(totalQty / 5) : 0;
    const promo3Discount = freeUnits * basePrice;
    const totalDiscount = Math.min(promo1Discount + promo3Discount, subtotal);
    const shippingWaived = promo2Active && totalQty >= 3;
    const finalShipping = shippingWaived ? 0 : shippingFee;
    const grandTotal = (subtotal - totalDiscount) + finalShipping;

    // ---------- 4. Enregistrement de la commande (prix et quantités du serveur, pas du client) ----------
    const orderRows = await sql`
      INSERT INTO orders (customer_id, status, total_amount)
      VALUES (${customer.id}, 'pending', ${grandTotal})
      RETURNING id
    `;
    const orderId = orderRows[0].id;

    for (const item of items) {
      const qty = Math.max(1, Math.min(20, Number(item.qty) || 1));
      await sql`
        INSERT INTO order_items
          (order_id, color_name, color_hex, color_fill, color_stroke, engraved_text, motif_description, unit_price, quantity, engraving_file)
        VALUES
          (${orderId}, ${item.colorName || 'Personnalisé'}, ${item.colorHex || null}, ${item.colorFill || null}, ${item.colorStroke || null},
           ${item.text || null}, ${item.motifDesc || null}, ${basePrice}, ${qty},
           ${item.engravingFile || null})
      `;
    }

    // ---------- 5. Lignes Stripe (prix serveur) + livraison ----------
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
          unit_amount: Math.round(basePrice * 100)
        },
        quantity: Math.max(1, Math.min(20, Number(item.qty) || 1))
      };
    });

    if (!shippingWaived) {
      line_items.push({
        price_data: {
          currency: 'eur',
          product_data: { name: 'Livraison' },
          unit_amount: Math.round(finalShipping * 100)
        },
        quantity: 1
      });
    }

    // ---------- 6. Remise (coupon Stripe, créé à la volée si nécessaire) ----------
    // Les Checkout Sessions n'acceptent qu'un seul coupon : on combine donc
    // la remise de 20% et celle de la 5ème offerte en un seul montant fixe.
    var discounts;
    const discountCents = Math.round(totalDiscount * 100);
    if (discountCents > 0) {
      const coupon = await stripe.coupons.create({
        amount_off: discountCents,
        currency: 'eur',
        duration: 'once',
        name: 'Promotion Ice Candle'
      });
      discounts = [{ coupon: coupon.id }];
    }

    const origin = req.headers.origin || ('https://' + req.headers.host);

    const sessionParams = {
      mode: 'payment',
      line_items: line_items,
      customer_email: customer.email,
      success_url: origin + '/?checkout=success&order_id=' + orderId,
      cancel_url: origin + '/?checkout=cancelled',
      shipping_address_collection: { allowed_countries: ['FR', 'BE', 'CH', 'MC', 'LU'] },
      metadata: { order_id: String(orderId) }
    };
    if (discounts) sessionParams.discounts = discounts;

    const session = await stripe.checkout.sessions.create(sessionParams);

    await sql`UPDATE orders SET stripe_session_id = ${session.id} WHERE id = ${orderId}`;

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    res.status(500).json({ error: 'Erreur lors de la création du paiement.' });
  }
};
