/**
 * Client officiel pour l'API Maketou (https://api.maketou.net)
 * Header d'authentification obligatoire : Authorization: Bearer ${process.env.MAKETOU_API_KEY}
 */
const fetch = globalThis.fetch || require('node-fetch');

const MAKETOU_BASE_URL = process.env.MAKETOU_API_BASE_URL || 'https://api.maketou.net';
const MAKETOU_API_KEY = process.env.MAKETOU_API_KEY;

function getHeaders() {
  return {
    'Authorization': `Bearer ${MAKETOU_API_KEY}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

/**
 * Endpoint 1 — Créer un panier et obtenir l'URL de paiement directe
 * POST https://api.maketou.net/api/v1/stores/cart/checkout
 */
async function createCartCheckout(payload) {
  const url = `${MAKETOU_BASE_URL}/api/v1/stores/cart/checkout`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  const responseData = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg = responseData.message || responseData.error || `Erreur Maketou HTTP ${response.status}`;
    const err = new Error(errorMsg);
    err.status = response.status;
    err.details = responseData;
    throw err;
  }

  return responseData;
}

/**
 * Endpoint 2 — Vérifier le statut réel d'un panier avec gestion 429
 * GET https://api.maketou.net/api/v1/stores/cart/{cartId}
 */
async function getCartStatus(cartId) {
  const url = `${MAKETOU_BASE_URL}/api/v1/stores/cart/${cartId}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: getHeaders()
  });

  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after') || 5;
    const err = new Error(`Rate limit Maketou atteint. Réessayer dans ${retryAfter}s`);
    err.status = 429;
    err.retryAfter = parseInt(retryAfter, 10);
    throw err;
  }

  const responseData = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err = new Error(responseData.message || `Erreur Maketou cart HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }

  return responseData;
}

module.exports = {
  createCartCheckout,
  getCartStatus
};
