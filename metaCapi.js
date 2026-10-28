/**
 * Moteur Meta Conversions API (CAPI) Server-Side pour Meta Andromeda
 * Hachage SHA-256 standard des données client et déduplication atomique par event_id.
 */
const crypto = require('crypto');
const fetch = globalThis.fetch || require('node-fetch');

function sha256(value) {
  if (!value) return '';
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function formatPhone(phone) {
  if (!phone) return '';
  return phone.replace(/[^0-9]/g, '');
}

/**
 * Envoie l'événement Purchase côté serveur vers Meta Graph API
 */
async function sendMetaPurchaseEvent({
  cartId,
  email,
  phone,
  firstName,
  lastName,
  clientIp,
  userAgent,
  fbp,
  fbc,
  amount = 2500,
  currency = 'XOF',
  eventSourceUrl
}) {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
  const apiVersion = process.env.META_GRAPH_API_VERSION || 'v21.0';

  if (!pixelId || !accessToken) {
    console.warn('[Meta CAPI] Pixel ID ou Access Token manquant dans le .env');
    return null;
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const eventId = `pur_${cartId}`;

  const userData = {
    em: [sha256(email)],
    ph: [sha256(formatPhone(phone))],
    fn: [sha256(firstName)],
    ln: [sha256(lastName)]
  };

  if (clientIp) userData.client_ip_address = clientIp;
  if (userAgent) userData.client_user_agent = userAgent;
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;

  const payload = {
    data: [
      {
        event_name: 'Purchase',
        event_time: eventTime,
        event_id: eventId,
        event_source_url: eventSourceUrl,
        action_source: 'website',
        user_data: userData,
        custom_data: {
          currency: currency,
          value: Number(amount),
          content_type: 'product',
          content_ids: [process.env.PRODUCT_DOCUMENT_ID || 'd3acfce0-ae5e-4751-876c-abba88835dd5'],
          content_name: "Guide Complet de l'Importation Chine-Afrique sur Smartphone",
          num_items: 1
        }
      }
    ]
  };

  const url = `https://graph.facebook.com/${apiVersion}/${pixelId}/events?access_token=${accessToken}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    console.log(`[Meta CAPI] Événement Purchase envoyé avec succès (${eventId}) :`, result);
    return result;
  } catch (err) {
    console.error('[Meta CAPI] Erreur d’envoi serveur :', err.message);
    return null;
  }
}

module.exports = {
  sendMetaPurchaseEvent,
  sha256
};
