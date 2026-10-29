/**
 * Moteur TikTok Events API (Conversions API) Server-Side
 * Documentation officielle TikTok Events API v1.3
 * Déduplication atomique par event_id avec le Pixel client.
 */
const crypto = require('crypto');
const fetch = globalThis.fetch || require('node-fetch');

function sha256(value) {
  if (!value) return '';
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function formatPhone(phone) {
  if (!phone) return '';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

/**
 * Envoie l'événement CompletePayment côté serveur vers TikTok Business API
 */
async function sendTikTokCompletePaymentEvent({
  cartId,
  email,
  phone,
  clientIp,
  userAgent,
  ttclid,
  ttp,
  amount = 1500,
  currency = 'XOF',
  eventSourceUrl,
  testEventCode,
  eventId: customEventId
}) {
  const pixelId = process.env.TIKTOK_PIXEL_ID || 'DBHO283C77U8I4RJ1KK0';
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN || '768bb41690ef8c180f32ffa08d411063236a87d2';

  if (!pixelId || !accessToken) {
    console.warn('[TikTok CAPI] Pixel ID ou Access Token manquant');
    return null;
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const eventId = customEventId || `pur_${cartId || Date.now()}`;

  const user = {};
  if (email) user.email = sha256(email);
  if (phone) user.phone = sha256(formatPhone(phone));
  if (clientIp) user.ip = clientIp;
  if (userAgent) user.user_agent = userAgent;
  if (ttclid) user.ttclid = ttclid;
  if (ttp) user.ttp = ttp;

  const payload = {
    event_source: 'web',
    event_source_id: pixelId,
    data: [
      {
        event: 'CompletePayment',
        event_time: eventTime,
        event_id: eventId,
        user,
        properties: {
          currency,
          value: Number(amount),
          content_type: 'product',
          contents: [
            {
              content_id: process.env.PRODUCT_DOCUMENT_ID || '550dff27-bf7d-4d7b-b997-7cc86bcc6771',
              content_name: "Guide Complet de l'Importation Chine-Afrique sur Smartphone",
              price: Number(amount),
              quantity: 1
            }
          ]
        },
        page: {
          url: eventSourceUrl
        }
      }
    ]
  };

  if (testEventCode) {
    payload.test_event_code = testEventCode;
  }

  const url = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': accessToken
      },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    console.log(`[TikTok CAPI] Événement CompletePayment envoyé (${eventId}) :`, result);
    return result;
  } catch (err) {
    console.error('[TikTok CAPI] Erreur d’envoi serveur :', err.message);
    return null;
  }
}

module.exports = {
  sendTikTokCompletePaymentEvent,
  sha256
};
