// api/photo-to-lineart.js
//
// Fonction serverless (Vercel). Reçoit une photo depuis le site, appelle
// l'API Replicate (ControlNet — préprocesseur "lineart") côté serveur avec
// la clé secrète, renvoie l'URL de l'image obtenue.
//
// La clé API ne doit JAMAIS être placée dans le code du site (index.html) :
// n'importe quel visiteur pourrait la lire et l'utiliser à vos frais. Elle
// vit uniquement ici, côté serveur, comme variable d'environnement.
//
// ⚠️ À VÉRIFIER AVANT MISE EN PRODUCTION
// Je n'ai pas pu tester cet appel contre l'API Replicate réelle (mon
// environnement n'y a pas accès). Les noms de champs ci-dessous
// ("image", "control_type": "lineart") correspondent à la convention que
// fofr utilise dans ses autres modèles ControlNet, mais avant de mettre ce
// fichier en production :
//   1. Créez un compte sur https://replicate.com et ouvrez la page
//      https://replicate.com/fofr/controlnet-preprocessors/api
//   2. Choisissez "Node.js" dans les exemples de code — Replicate y génère
//      un appel toujours synchronisé avec le modèle actuel.
//   3. Comparez les noms de champs dans "input" avec ceux utilisés plus bas
//      et corrigez si besoin.
//
// Modèle utilisé : fofr/controlnet-preprocessors (préprocesseur seul, sans
// génération complète) — environ 0,0075 $ par image, résultat en quelques
// secondes. Alternative plus "stylisée" mais plus chère et plus lente :
// un modèle ControlNet + Stable Diffusion complet (ex. celui d'usamaehsan,
// ~0,017 $/image) — même structure d'appel, juste une autre URL de modèle.

const REPLICATE_MODEL_URL = 'https://api.replicate.com/v1/models/fofr/controlnet-preprocessors/predictions';

module.exports = async function handler(req, res) {
  // CORS — remplacez '*' par votre nom de domaine une fois en production,
  // ex. 'https://www.ice-candle-cannes.fr'
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Méthode non autorisée.' }); return; }

  if (!process.env.REPLICATE_API_TOKEN) {
    res.status(500).json({ error: 'REPLICATE_API_TOKEN manquant côté serveur.' });
    return;
  }

  const { imageDataUrl } = req.body || {};
  if (!imageDataUrl || typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image')) {
    res.status(400).json({ error: 'Image manquante ou invalide.' });
    return;
  }

  try {
    const createResponse = await fetch(REPLICATE_MODEL_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
        // Mode synchrone : la requête attend jusqu'à 60s la réponse
        // directement, pas besoin d'implémenter de file d'attente pour ce
        // cas d'usage simple.
        'Prefer': 'wait'
      },
      body: JSON.stringify({
        input: {
          image: imageDataUrl,
          control_type: 'lineart'
        }
      })
    });

    const prediction = await createResponse.json();

    if (!createResponse.ok) {
      console.error('Replicate error:', prediction);
      res.status(502).json({ error: (prediction && prediction.detail) || 'Erreur de l\u2019API Replicate.' });
      return;
    }

    let output = prediction.output;

    // Si le traitement a dépassé la fenêtre synchrone de 60s, on interroge
    // le statut pendant 30 secondes de plus avant d'abandonner.
    if (!output && prediction.urls && prediction.urls.get) {
      for (let i = 0; i < 15 && !output; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollResp = await fetch(prediction.urls.get, {
          headers: { 'Authorization': `Bearer ${process.env.REPLICATE_API_TOKEN}` }
        });
        const pollData = await pollResp.json();
        if (pollData.status === 'succeeded') { output = pollData.output; break; }
        if (pollData.status === 'failed' || pollData.status === 'canceled') {
          res.status(502).json({ error: 'La génération a échoué côté Replicate.' });
          return;
        }
      }
    }

    if (!output) {
      res.status(504).json({ error: 'Délai dépassé — réessayez.' });
      return;
    }

    // La sortie peut être une seule URL ou un tableau d'URLs selon le
    // modèle (celui-ci peut renvoyer plusieurs variantes de préprocesseur) ;
    // on prend la première.
    const imageUrl = Array.isArray(output) ? output[0] : output;
    res.status(200).json({ imageUrl });
  } catch (err) {
    console.error('photo-to-lineart error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
