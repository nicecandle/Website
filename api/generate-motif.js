// api/generate-motif.js
//
// Fonction serverless (Vercel). Reçoit une description texte depuis le
// site, appelle l'API Replicate (modèle Flux Schnell — génération d'image à
// partir de texte) côté serveur avec la clé secrète, renvoie l'URL de
// l'image obtenue. Le site convertit ensuite cette image en dessin au trait
// via le même algorithme déjà utilisé pour les photos importées (voir
// photoToLineArt() dans index.html), pour un rendu final cohérent avec le
// reste du site.
//
// La clé API ne doit JAMAIS être placée dans le code du site (index.html) :
// n'importe quel visiteur pourrait la lire et l'utiliser à vos frais. Elle
// vit uniquement ici, côté serveur, comme variable d'environnement
// (REPLICATE_API_TOKEN — la même que pour photo-to-lineart.js).
//
// Modèle utilisé : black-forest-labs/flux-schnell — modèle officiel Replicate
// (API stable, pas besoin de figer un numéro de version), environ 0,003 $
// par image, résultat en quelques secondes. C'est le modèle le plus rapide
// et le moins cher de la famille Flux, adapté à un usage interactif comme
// celui-ci.

const REPLICATE_MODEL_URL = 'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions';

// Ajouté après la description du client pour orienter le résultat vers un
// style compatible avec la gravure (trait simple, pas de dégradés ni de
// couleur) plutôt qu'une image photoréaliste.
const STYLE_SUFFIX = ', simple black and white line art, thin clean outlines, minimalist hand-drawn illustration, no shading, no color, white background';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Méthode non autorisée.' }); return; }

  if (!process.env.REPLICATE_API_TOKEN) {
    res.status(500).json({ error: 'REPLICATE_API_TOKEN manquant côté serveur.' });
    return;
  }

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    res.status(400).json({ error: 'Description manquante.' });
    return;
  }
  // Limite raisonnable : évite un prompt démesuré (coût, temps de traitement).
  const cleanPrompt = prompt.trim().slice(0, 300);

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
          prompt: cleanPrompt + STYLE_SUFFIX,
          aspect_ratio: '1:1', // la zone de gravure est carrée (60 x 60 mm)
          output_format: 'png',
          output_quality: 90,
          num_outputs: 1
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

    // flux-schnell renvoie un tableau d'URLs (une par sortie demandée) ;
    // num_outputs vaut 1 ici, donc on prend la première.
    const imageUrl = Array.isArray(output) ? output[0] : output;
    res.status(200).json({ imageUrl });
  } catch (err) {
    console.error('generate-motif error:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
