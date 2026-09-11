// lib/db.js
//
// Connexion à la base de données Postgres, via le driver serverless de Neon
// — conçu spécifiquement pour ce contexte (fonctions serverless Vercel) :
// il utilise HTTP plutôt que des connexions TCP classiques, qui s'épuiseraient
// rapidement avec un pool de connexions traditionnel dans ce genre
// d'environnement (chaque requête peut démarrer une nouvelle instance).
//
// Variable d'environnement requise : DATABASE_URL
// Fournie automatiquement par l'intégration Vercel Postgres si vous
// l'utilisez, ou à copier depuis le tableau de bord Neon sinon (utilisez
// l'URL de connexion "pooled" si Neon vous en propose une).

const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  console.warn('⚠️ DATABASE_URL manquant — les appels à la base de données échoueront.');
}

const sql = neon(process.env.DATABASE_URL);

module.exports = { sql };
