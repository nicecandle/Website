// lib/email.js
//
// Envoi d'e-mails via Resend (resend.com), utilisé pour :
// - la notification de nouvelle commande à l'atelier
// - la confirmation de commande au client
// - les e-mails de changement de statut (en préparation, expédiée)
//
// Variables d'environnement requises pour que l'envoi fonctionne :
//   RESEND_API_KEY — clé API Resend
//   RESEND_FROM_EMAIL — optionnel ; adresse d'expédition. Doit être sur un
//     domaine vérifié dans Resend pour pouvoir écrire à n'importe quel
//     destinataire ; à défaut, utilise onboarding@resend.dev, qui ne peut
//     écrire qu'à l'adresse du compte Resend lui-même tant qu'aucun domaine
//     n'est vérifié.
//
// Un échec d'envoi (clé manquante, domaine non vérifié, panne Resend...) ne
// lève jamais d'exception ici — il est seulement journalisé. L'envoi d'un
// e-mail est toujours secondaire à l'action principale (paiement confirmé,
// statut mis à jour) : un e-mail manqué ne doit jamais faire échouer cette
// action-là.

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function formatPrice(n) {
  return Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '\u00A0€';
}

async function sendEmail(opts) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY manquant — e-mail non envoyé :', opts.subject);
    return { skipped: true };
  }
  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromAddress = process.env.RESEND_FROM_EMAIL || 'Ice Candle Cannes <onboarding@resend.dev>';
    const result = await resend.emails.send({
      from: fromAddress,
      to: Array.isArray(opts.to) ? opts.to : [opts.to],
      subject: opts.subject,
      html: opts.html,
      attachments: opts.attachments && opts.attachments.length ? opts.attachments : undefined
    });
    if (result && result.error) {
      console.error('Échec envoi e-mail :', opts.subject, result.error);
    } else {
      console.log('E-mail envoyé :', opts.subject, '→', opts.to);
    }
    return result;
  } catch (err) {
    console.error('Erreur envoi e-mail :', opts.subject, err);
    return { error: err };
  }
}

// En-tête et pied de message communs aux e-mails envoyés au client, pour un
// rendu cohérent avec l'identité du site.
function customerEmailWrapper(innerHtml) {
  return '<div style="font-family:Georgia, serif; max-width:560px; margin:0 auto; color:#1a1a1a; line-height:1.6;">' +
    '<h1 style="font-size:20px; letter-spacing:.02em; margin-bottom:2px;">Ice Candle <em style="color:#e8813a;">Cannes</em></h1>' +
    '<div style="height:1px; background:#e5e5e5; margin:14px 0 22px;"></div>' +
    innerHtml +
    '<div style="height:1px; background:#e5e5e5; margin:26px 0 14px;"></div>' +
    '<p style="font-size:12.5px; color:#888;">Atelier de gravure sur verre — Cannes<br>Une question ? Écrivez-nous à atelier@icecandle.fr</p>' +
    '</div>';
}

module.exports = { sendEmail, escapeHtml, formatPrice, customerEmailWrapper };
