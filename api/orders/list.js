// api/orders/list.js
const { sql } = require('../../lib/db');
const { parseCookies, getCustomerFromSession } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method !== 'GET') { res.status(405).json({ error: 'Méthode non autorisée.' }); return; }

  const cookies = parseCookies(req);
  const customer = await getCustomerFromSession(cookies.ic_session);
  if (!customer) { res.status(401).json({ error: 'Non connecté.' }); return; }

  try {
    const orders = await sql`
      SELECT id, status, total_amount, tracking_number, created_at FROM orders
      WHERE customer_id = ${customer.id} ORDER BY created_at DESC
    `;
    const result = [];
    for (const order of orders) {
      const items = await sql`
        SELECT color_name, color_hex, color_fill, color_stroke, engraved_text, motif_description, unit_price, quantity, engraving_file, scent_name
        FROM order_items WHERE order_id = ${order.id}
      `;
      result.push({
        id: order.id,
        status: order.status,
        trackingNumber: order.tracking_number,
        total: Number(order.total_amount),
        date: order.created_at,
        items: items.map(function (it) {
          return {
            color: { name: it.color_name, hex: it.color_hex, fill: it.color_fill, stroke: it.color_stroke },
            text: it.engraved_text,
            motifDesc: it.motif_description,
            unitPrice: Number(it.unit_price),
            qty: it.quantity,
            engravingFile: it.engraving_file,
            scentName: it.scent_name
          };
        })
      });
    }
    res.status(200).json({ orders: result });
  } catch (err) {
    console.error('orders/list error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
