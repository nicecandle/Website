// api/stripe-webhook.js
//
// Reçoit les notifications de Stripe (paiement confirmé, etc.). C'est la
// source de vérité pour savoir si une commande a réellement été payée —
// contrairement à la redirection du visiteur après paiement, qui n'est pas
// fiable à elle seule (il peut fermer l'onglet avant la redirection, ou
// quelqu'un pourrait deviner l'URL de succès sans avoir payé).
//
// Envoie aussi un e-mail de notification à l'atelier dès qu'une commande
// est marquée payée, avec le détail client/commande et le(s) fichier(s) de
// gravure en pièce jointe.
//
// Variables d'environnement requises :
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET — généré par Stripe lors de la création du webhook
//   DATABASE_URL
//   RESEND_API_KEY — clé API Resend (resend.com), pour l'e-mail de notification
//   ORDER_NOTIFICATION_EMAIL — adresse de l'atelier qui doit recevoir ces e-mails
//   RESEND_FROM_EMAIL — optionnel, adresse d'expédition (doit être sur un
//     domaine vérifié dans Resend pour pouvoir écrire à ORDER_NOTIFICATION_EMAIL ;
//     à défaut, utilise onboarding@resend.dev, qui ne peut écrire qu'à l'adresse
//     de votre propre compte Resend tant qu'aucun domaine n'est vérifié)

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { sql } = require('../lib/db');

// Stripe a besoin du corps brut (non parsé) de la requête pour vérifier la
// signature — on désactive donc le parsing JSON automatique de Vercel.
module.exports.config = { api: { bodyParser: false } };

function buffer(readable) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    readable.on('data', function (chunk) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    readable.on('end', function () { resolve(Buffer.concat(chunks)); });
    readable.on('error', reject);
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function formatPrice(n) {
  return Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '\u00A0€';
}

// Construit et envoie l'e-mail de notification de commande à l'atelier.
// N'importe quel souci ici (clé manquante, domaine non vérifié, panne
// Resend...) est intercepté par l'appelant : une notification manquée ne
// doit jamais faire échouer la confirmation du paiement lui-même.
async function sendOrderNotificationEmail(orderId, session) {
  if (!process.env.RESEND_API_KEY || !process.env.ORDER_NOTIFICATION_EMAIL) {
    console.warn('Notification e-mail ignorée : RESEND_API_KEY ou ORDER_NOTIFICATION_EMAIL manquant.');
    return;
  }

  const orderRows = await sql`
    SELECT o.id, o.total_amount, o.created_at, c.email AS customer_email
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ${orderId}
  `;
  if (orderRows.length === 0) return;
  const order = orderRows[0];

  const items = await sql`
    SELECT color_name, engraved_text, motif_description, scent_name, unit_price, quantity, engraving_file
    FROM order_items WHERE order_id = ${orderId}
  `;

  const shipping = session.shipping_details || null;
  const customerDetails = session.customer_details || null;

  const itemsHtml = items.map(function (it) {
    return '<tr>' +
      '<td style="padding:8px 10px; border-bottom:1px solid #e5e5e5;">' + escapeHtml(it.color_name) + '</td>' +
      '<td style="padding:8px 10px; border-bottom:1px solid #e5e5e5;">' + escapeHtml(it.scent_name || '—') + '</td>' +
      '<td style="padding:8px 10px; border-bottom:1px solid #e5e5e5;">' + (it.engraved_text ? '« ' + escapeHtml(it.engraved_text) + ' »' : '—') + (it.motif_description ? '<br><span style="color:#777; font-size:12px;">' + escapeHtml(it.motif_description) + '</span>' : '') + '</td>' +
      '<td style="padding:8px 10px; border-bottom:1px solid #e5e5e5; text-align:center;">' + it.quantity + '</td>' +
      '<td style="padding:8px 10px; border-bottom:1px solid #e5e5e5; text-align:right;">' + formatPrice(it.unit_price) + '</td>' +
      '</tr>';
  }).join('');

  const shippingHtml = shipping
    ? '<p style="margin:4px 0;"><strong>' + escapeHtml(shipping.name || '') + '</strong><br>' +
      (shipping.address ? [shipping.address.line1, shipping.address.line2, (shipping.address.postal_code || '') + ' ' + (shipping.address.city || ''), shipping.address.country]
        .filter(Boolean).map(escapeHtml).join('<br>') : '') + '</p>'
    : '<p style="margin:4px 0; color:#777;">Non renseignée</p>';

  const html =
    '<div style="font-family:Georgia, serif; max-width:640px; margin:0 auto; color:#1a1a1a;">' +
      '<h2 style="margin-bottom:4px;">Nouvelle commande #' + order.id + '</h2>' +
      '<p style="color:#777; margin-top:0;">' + new Date(order.created_at).toLocaleString('fr-FR') + '</p>' +
      '<h3 style="margin-bottom:4px;">Client</h3>' +
      '<p style="margin:4px 0;">' + escapeHtml((customerDetails && customerDetails.email) || order.customer_email) +
        (customerDetails && customerDetails.name ? '<br>' + escapeHtml(customerDetails.name) : '') +
        (customerDetails && customerDetails.phone ? '<br>' + escapeHtml(customerDetails.phone) : '') + '</p>' +
      '<h3 style="margin-bottom:4px;">Adresse de livraison</h3>' +
      shippingHtml +
      '<h3 style="margin-bottom:4px;">Articles</h3>' +
      '<table style="width:100%; border-collapse:collapse; font-size:14px;">' +
        '<thead><tr style="background:#f5f5f5; text-align:left;">' +
          '<th style="padding:8px 10px;">Teinte</th><th style="padding:8px 10px;">Parfum</th>' +
          '<th style="padding:8px 10px;">Gravure</th><th style="padding:8px 10px; text-align:center;">Qté</th>' +
          '<th style="padding:8px 10px; text-align:right;">Prix unitaire</th>' +
        '</tr></thead>' +
        '<tbody>' + itemsHtml + '</tbody>' +
      '</table>' +
      '<p style="text-align:right; font-size:16px; margin-top:14px;"><strong>Total : ' + formatPrice(order.total_amount) + '</strong></p>' +
      '<p style="color:#777; font-size:13px;">' +
        (items.some(function (it) { return it.engraving_file; })
          ? 'Le ou les fichiers de gravure (SVG, prêts pour xTool Studio) sont joints à cet e-mail.'
          : 'Aucun fichier de gravure disponible pour cette commande.') +
      '</p>' +
    '</div>';

  const attachments = items
    .map(function (it, idx) {
      if (!it.engraving_file) return null;
      return {
        filename: 'gravure-commande-' + order.id + '-article-' + (idx + 1) + '.svg',
        content: Buffer.from(it.engraving_file, 'utf8').toString('base64')
      };
    })
    .filter(Boolean);

  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromAddress = process.env.RESEND_FROM_EMAIL || 'Ice Candle Cannes <onboarding@resend.dev>';

  const result = await resend.emails.send({
    from: fromAddress,
    to: [process.env.ORDER_NOTIFICATION_EMAIL],
    subject: 'Nouvelle commande #' + order.id + ' — ' + formatPrice(order.total_amount),
    html: html,
    attachments: attachments.length ? attachments : undefined
  });

  if (result && result.error) {
    console.error('Échec envoi e-mail de notification (commande', order.id, ') :', result.error);
  } else {
    console.log('E-mail de notification envoyé pour la commande', order.id);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  var event;
  try {
    var rawBody = await buffer(req);
    var signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Signature webhook invalide :', err.message);
    res.status(400).send('Webhook Error: ' + err.message);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    var session = event.data.object;
    var orderId = session.metadata && session.metadata.order_id;
    if (orderId) {
      try {
        await sql`UPDATE orders SET status = 'paid', stripe_session_id = ${session.id} WHERE id = ${orderId}`;
        console.log('Commande', orderId, 'marquée payée. Session Stripe:', session.id);
      } catch (err) {
        console.error('Erreur mise à jour commande', orderId, err);
      }

      // La notification e-mail est secondaire au paiement lui-même : un
      // souci ici ne doit jamais faire échouer la réponse au webhook (Stripe
      // réessaierait sinon indéfiniment un événement déjà bien traité).
      try {
        await sendOrderNotificationEmail(orderId, session);
      } catch (err) {
        console.error('Erreur envoi e-mail de notification pour la commande', orderId, err);
      }
    } else {
      console.warn('checkout.session.completed reçu sans metadata.order_id — session', session.id);
    }
  }

  res.status(200).json({ received: true });
};
