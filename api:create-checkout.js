// api/create-checkout.js
// Vercel Serverless Function — crée une session de paiement Stripe

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // clé service (pas anon) pour écrire côté serveur
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { texte, pseudo, email } = req.body;

  // Validation serveur
  if (!texte || texte.trim().length < 5) {
    return res.status(400).json({ error: 'Message trop court' });
  }
  if (texte.length > 500) {
    return res.status(400).json({ error: 'Message trop long' });
  }

  try {
    // 1. Enregistrer le message en attente (visible = false)
    const { data: message, error } = await db
      .from('messages')
      .insert({
        texte: texte.trim(),
        pseudo: pseudo || 'Anonyme',
        email: email || null,
        visible: false
      })
      .select()
      .single();

    if (error) throw error;

    // 2. Créer la session Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'Message gravé pour toujours',
            description: 'lederniermessage.com — 1 message permanent'
          },
          unit_amount: 100 // 1,00 € en centimes
        },
        quantity: 1
      }],
      mode: 'payment',
      customer_email: email || undefined,
      metadata: {
        message_id: message.id
      },
      success_url: `${process.env.SITE_URL}/?success=1`,
      cancel_url: `${process.env.SITE_URL}/?annule=1`
    });

    res.status(200).json({ url: session.url });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
