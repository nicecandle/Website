// api/admin/customers.js
// Protégé par session admin. Liste tous les comptes clients avec leur
// historique de commandes complet — remplace l'ancienne lecture directe du
// localStorage (qui ne montrait que les comptes créés dans le même
// navigateur que l'administration).

const { sql } = require('../../lib/db');
const { parseCookies, isAdminSessionValid } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method !== 'GET') { res.status(405).json({ error: 'Méthode non autorisée.' }); return; }

  const cookies = parseCookies(req);
  const ok = await isAdminSessionValid(cookies.ic_admin_session);
  if (!ok) { res.status(401).json({ error: 'Non autorisé.' }); return; }

  try {
    const customers = await sql`SELECT id, email, created_at FROM customers ORDER BY created_at DESC`;
    const result = [];
    for (const c of customers) {
      const orders = await sql`
        SELECT id, status, total_amount, tracking_number, created_at FROM orders
        WHERE customer_id = ${c.id} ORDER BY created_at DESC
      `;
      const ordersWithItems = [];
      for (const o of orders) {
        const items = await sql`
          SELECT color_name, engraved_text, motif_description, unit_price, quantity, engraving_file, scent_name
          FROM order_items WHERE order_id = ${o.id}
        `;
        // Le fichier de gravure n'est transmis à l'administration qu'une
        // fois la commande réellement payée — "en tampon" jusque-là,
        // conformément au principe demandé (pas de fabrication sur une
        // commande non réglée). Payée, en préparation ou expédiée comptent
        // toutes comme "payée" ici : seule 'pending' bloque encore le fichier.
        const isPaidOrLater = o.status !== 'pending';
        ordersWithItems.push({
          id: o.id,
          status: o.status,
          trackingNumber: o.tracking_number,
          total: Number(o.total_amount),
          date: o.created_at,
          items: items.map(function (it) {
            return {
              colorName: it.color_name,
              text: it.engraved_text,
              motifDesc: it.motif_description,
              scentName: it.scent_name,
              unitPrice: Number(it.unit_price),
              qty: it.quantity,
              engravingFile: isPaidOrLater ? it.engraving_file : null
            };
          })
        });
      }
      result.push({ email: c.email, createdAt: c.created_at, orders: ordersWithItems });
    }
    res.status(200).json({ customers: result });
  } catch (err) {
    console.error('admin/customers error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
