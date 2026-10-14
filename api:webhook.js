// api/webhook.js
// Vercel Serverless Function — écoute les événements Stripe
// Quand le paiement est confirmé → rend le message visible

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// Nécessaire pour que Stripe puisse vérifier la signature
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Webhook signature invalide:', e.message);
    return res.status(400).json({ error: 'Signature invalide' });
  }

  // Paiement réussi
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const messageId = session.metadata?.message_id;

    if (!messageId) return res.status(200).json({ ok: true });

    try {
      // Rendre le message visible
      const { data: message } = await db
        .from('messages')
        .update({ visible: true })
        .eq('id', messageId)
        .select()
        .single();

      // Compter le total
      const { count } = await db
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('visible', true);

      // Envoyer email de confirmation si email fourni
      if (message?.email) {
        await resend.emails.send({
          from: 'Le Dernier Message <contact@lederniermessage.com>',
          to: message.email,
          subject: 'Ton message est gravé pour toujours',
          html: `
            <div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; padding: 40px 20px; color: #0A0A0A;">
              <p style="font-size: 13px; color: #888; margin-bottom: 32px;">lederniermessage.com</p>
              <h1 style="font-size: 24px; font-weight: 400; margin-bottom: 16px; line-height: 1.2;">Ton message est gravé.</h1>
              <p style="font-size: 15px; color: #444; margin-bottom: 32px;">Il fait désormais partie des <strong>${(count || 0).toLocaleString('fr-FR')}</strong> messages permanents sur lederniermessage.com. Il ne sera jamais modifié, jamais supprimé.</p>
              <blockquote style="border-left: 2px solid #D4D4D4; padding-left: 16px; margin: 0 0 32px; font-size: 18px; line-height: 1.6; color: #0A0A0A;">
                ${message.texte.replace(/</g,'&lt;').replace(/>/g,'&gt;')}
              </blockquote>
              <p style="font-size: 13px; color: #888;">— ${message.pseudo || 'Anonyme'}</p>
              <hr style="border: none; border-top: 1px solid #F0F0F0; margin: 32px 0;" />
              <p style="font-size: 12px; color: #aaa;">Il reste ${(1000000 - (count || 0)).toLocaleString('fr-FR')} places sur le site.</p>
            </div>
          `
        });
      }

    } catch (e) {
      console.error('Erreur après paiement:', e);
    }
  }

  res.status(200).json({ ok: true });
};
