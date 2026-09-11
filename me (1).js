// api/auth/me.js
const { parseCookies, getCustomerFromSession } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method !== 'GET') { res.status(405).json({ error: 'Méthode non autorisée.' }); return; }

  const cookies = parseCookies(req);
  const customer = await getCustomerFromSession(cookies.ic_session);
  if (!customer) { res.status(401).json({ error: 'Non connecté.' }); return; }
  res.status(200).json({ email: customer.email });
};
