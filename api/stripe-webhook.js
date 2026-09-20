// api/stripe-webhook.js
//
// Reçoit les notifications de Stripe (paiement confirmé, etc.). C'est la
// source de vérité pour savoir si une commande a réellement été payée —
// contrairement à la redirection du visiteur après paiement, qui n'est pas
// fiable à elle seule (il peut fermer l'onglet avant la redirection, ou
// quelqu'un pourrait deviner l'URL de succès sans avoir payé).
//
// Envoie deux e-mails dès qu'une commande est marquée payée :
// - à l'atelier (détail complet + fichier de gravure en pièce jointe)
// - au client (confirmation de commande)
//
// Variables d'environnement requises :
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET — généré par Stripe lors de la création du webhook
//   DATABASE_URL
//   RESEND_API_KEY, RESEND_FROM_EMAIL — voir lib/email.js
//   ORDER_NOTIFICATION_EMAIL — adresse de l'atelier qui reçoit le détail de commande

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { sql } = require('../lib/db');
const { sendEmail, escapeHtml, formatPrice, customerEmailWrapper } = require('../lib/email');

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

// Charge la commande complète (client + articles) une fois — les deux
// e-mails (atelier et client) en ont besoin, chacun n'en gardant que ce qui
// le concerne.
async function loadFullOrder(orderId) {
  const orderRows = await sql`
    SELECT o.id, o.total_amount, o.created_at, c.email AS customer_email
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ${orderId}
  `;
  if (orderRows.length === 0) return null;
  const items = await sql`
    SELECT color_name, engraved_text, motif_description, scent_name, unit_price, quantity, engraving_file
    FROM order_items WHERE order_id = ${orderId}
  `;
  return { order: orderRows[0], items: items };
}

function itemsTableRows(items, includeEngravingNote) {
  return items.map(function (it) {
    return '<tr>' +
      '<td style="padding:8px 10px; border-bottom:1px solid #e5e5e5;">' + escapeHtml(it.color_name) + '</td>' +
      '<td style="padding:8px 10px; border-bottom:1px solid #e5e5e5;">' + escapeHtml(it.scent_name || '—') + '</td>' +
      '<td style="padding:8px 10px; border-bottom:1px solid #e5e5e5;">' + (it.engraved_text ? '« ' + escapeHtml(it.engraved_text) + ' »' : '—') + (it.motif_description ? '<br><span style="color:#777; font-size:12px;">' + escapeHtml(it.motif_description) + '</span>' : '') + '</td>' +
      '<td style="padding:8px 10px; border-bottom:1px solid #e5e5e5; text-align:center;">' + it.quantity + '</td>' +
      '<td style="padding:8px 10px; border-bottom:1px solid #e5e5e5; text-align:right;">' + formatPrice(it.unit_price) + '</td>' +
      '</tr>';
  }).join('');
}

function itemsTable(items) {
  return '<table style="width:100%; border-collapse:collapse; font-size:14px;">' +
    '<thead><tr style="background:#f5f5f5; text-align:left;">' +
      '<th style="padding:8px 10px;">Teinte</th><th style="padding:8px 10px;">Parfum</th>' +
      '<th style="padding:8px 10px;">Gravure</th><th style="padding:8px 10px; text-align:center;">Qté</th>' +
      '<th style="padding:8px 10px; text-align:right;">Prix unitaire</th>' +
    '</tr></thead>' +
    '<tbody>' + itemsTableRows(items) + '</tbody>' +
  '</table>';
}

// E-mail à l'atelier : tout le détail utile à la fabrication, avec le(s)
// fichier(s) de gravure en pièce jointe.
async function sendWorkshopNotification(orderId, session) {
  if (!process.env.ORDER_NOTIFICATION_EMAIL) {
    console.warn('ORDER_NOTIFICATION_EMAIL manquant — notification atelier non envoyée.');
    return;
  }
  const full = await loadFullOrder(orderId);
  if (!full) return;
  const { order, items } = full;

  const shipping = session.shipping_details || null;
  const customerDetails = session.customer_details || null;

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
      itemsTable(items) +
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

  await sendEmail({
    to: process.env.ORDER_NOTIFICATION_EMAIL,
    subject: 'Nouvelle commande #' + order.id + ' — ' + formatPrice(order.total_amount),
    html: html,
    attachments: attachments
  });
}

// E-mail au client : confirmation chaleureuse, sans détail technique interne
// (pas de fichier de gravure — inutile pour le client, réservé à l'atelier).
async function sendCustomerConfirmation(orderId) {
  const full = await loadFullOrder(orderId);
  if (!full) return;
  const { order, items } = full;

  const html = customerEmailWrapper(
    '<p>Merci pour votre commande !</p>' +
    '<p>Nous avons bien reçu votre paiement pour la commande <strong>#' + order.id + '</strong>, et votre bougie va être préparée avec soin.</p>' +
    itemsTable(items) +
    '<p style="text-align:right; font-size:16px; margin-top:14px;"><strong>Total : ' + formatPrice(order.total_amount) + '</strong></p>' +
    '<p>Vous serez prévenu(e) par e-mail à chaque étape de la préparation de votre commande.</p>'
  );

  await sendEmail({
    to: order.customer_email,
    subject: 'Votre commande Ice Candle Cannes #' + order.id + ' est confirmée',
    html: html
  });
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

      // Les e-mails sont secondaires au paiement lui-même : un souci ici ne
      // doit jamais faire échouer la réponse au webhook (Stripe réessaierait
      // sinon indéfiniment un événement déjà bien traité).
      try {
        await sendWorkshopNotification(orderId, session);
      } catch (err) {
        console.error('Erreur envoi notification atelier pour la commande', orderId, err);
      }
      try {
        await sendCustomerConfirmation(orderId);
      } catch (err) {
        console.error('Erreur envoi confirmation client pour la commande', orderId, err);
      }
    } else {
      console.warn('checkout.session.completed reçu sans metadata.order_id — session', session.id);
    }
  }

  res.status(200).json({ received: true });
};
