// api/stripe-webhook.js
//
// Reçoit les notifications de Stripe (paiement confirmé, etc.). C'est la
// source de vérité pour savoir si une commande a réellement été payée —
// contrairement à la redirection du visiteur après paiement, qui n'est pas
// fiable à elle seule (il peut fermer l'onglet avant la redirection, ou
// quelqu'un pourrait deviner l'URL de succès sans avoir payé).
//
// Variables d'environnement requises :
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET — généré par Stripe lors de la création du webhook
//   DATABASE_URL

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
    } else {
      console.warn('checkout.session.completed reçu sans metadata.order_id — session', session.id);
    }
  }

  res.status(200).json({ received: true });
};
