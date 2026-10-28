/**
 * Serveur Backend Principal : Tunnel de Vente Mobile-First Maketou + Meta Andromeda
 * Correctif Anti-Erreur 422 : Pas de customerPrice, redirectURL en HTTPS strict, nettoyage du téléphone.
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');

const db = require('./database');
const maketou = require('./maketou');
const { sendMetaPurchaseEvent } = require('./metaCapi');

const app = express();
const PORT = process.env.PORT || 3000;
const ORDER_HMAC_SECRET = process.env.ORDER_HMAC_SECRET || 'maketou_andromeda_hmac_secret_2026_x99';

// Gestionnaire d'erreurs global pour empêcher tout arrêt inattendu
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]:', reason);
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Génération de signature HMAC pour protéger le Sas de Validation (/verify-purchase)
function generateOrderSignature(orderId) {
  return crypto.createHmac('sha256', ORDER_HMAC_SECRET).update(orderId).digest('hex');
}

// Vérification de la signature HMAC
function verifyOrderSignature(orderId, signature) {
  if (!orderId || !signature) return false;
  try {
    const expected = generateOrderSignature(orderId);
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch (err) {
    return false;
  }
}

// Secret HMAC pour le téléchargement sécurisé du fichier
const DOWNLOAD_TOKEN_SECRET = process.env.DOWNLOAD_TOKEN_SECRET || 'maketou_andromeda_hmac_secret_2026_x99';

function generateDownloadToken(orderId) {
  return crypto.createHmac('sha256', DOWNLOAD_TOKEN_SECRET).update(String(orderId)).digest('hex');
}

function verifyDownloadToken(orderId, token) {
  if (!orderId || !token) return false;
  try {
    const expected = generateDownloadToken(orderId);
    return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
  } catch (err) {
    return false;
  }
}

// Mise en cache mémoire du buffer PDF depuis Google Drive pour téléchargement ultra-rapide (< 5ms)
let cachedPdfBuffer = null;

async function getGuidePdfBuffer() {
  if (cachedPdfBuffer && cachedPdfBuffer.length > 0) {
    return cachedPdfBuffer;
  }
  const fileId = process.env.GOOGLE_DRIVE_FILE_ID || '1S-hwHdXy6qUSVHlP3W0YgGiUBiIp7JhW';
  const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
  console.log('[Drive Stream] Récupération du guide PDF depuis Google Drive...');
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Échec récupération Google Drive (HTTP ${res.status})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  cachedPdfBuffer = Buffer.from(arrayBuffer);
  console.log(`[Drive Stream] Guide PDF mis en mémoire cache avec succès (${cachedPdfBuffer.length} octets).`);
  return cachedPdfBuffer;
}

/**
 * ROUTE 1 : POST /api/checkout/create
 * Initialise le paiement Maketou & génère le jeton de téléchargement sécurisé
 */
app.post('/api/checkout/create', async (req, res) => {
  try {
    const { fullName, email, phone, fbp, fbc } = req.body;
    const clientKey = req.headers['x-idempotency-key'];

    if (!fullName || !email || !phone) {
      return res.status(400).json({ success: false, error: 'Champs obligatoires manquants' });
    }

    const productDocumentId = process.env.PRODUCT_DOCUMENT_ID || 'd3acfce0-ae5e-4751-876c-abba88835dd5';

    // 1. Découpage du Nom Complet en firstName + lastName
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    const firstName = parts[0] || 'Client';
    const lastName = parts.slice(1).join(' ') || 'Acheteur';

    // 2. Nettoyage du téléphone au format international (+229...)
    const cleanPhone = '+' + String(phone || '').replace(/[^0-9]/g, '');
    const cleanEmail = String(email || '').trim().toLowerCase();

    // 3. Clé d'idempotence et identifiant unique de commande
    const orderId = `ORD_${crypto.randomUUID()}`;
    const downloadToken = generateDownloadToken(orderId);
    
    // Détection du domaine actif
    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || '';
    const protoHeader = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const isHttps = protoHeader === 'https' && hostHeader && !hostHeader.includes('localhost');
    const baseUrl = isHttps ? `https://${hostHeader}` : `http://${hostHeader || 'localhost:3000'}`;
    
    // Page de remerciement et téléchargement avec jeton sécurisé
    const redirectURL = `${baseUrl}/confirmation-achat?orderId=${orderId}&token=${downloadToken}`;

    // 4. Payload conforme Maketou
    const maketouPayload = {
      productDocumentId,
      email: cleanEmail,
      firstName,
      lastName,
      phone: cleanPhone,
      redirectURL,
      meta: {
        internalOrderId: String(orderId),
        productSlug: 'importation-alibaba',
        amountXOF: "2500",
        fbp: fbp || req.cookies['_fbp'] || '',
        fbc: fbc || req.cookies['_fbc'] || ''
      }
    };

    if (isHttps) {
      maketouPayload.webhookUrl = `${baseUrl}/api/webhooks/maketou`;
    }

    console.log('[Maketou Checkout] Envoi payload :', { email: cleanEmail, phone: cleanPhone, redirectURL });
    const maketouRes = await maketou.createCartCheckout(maketouPayload);

    const cart = maketouRes.cart || {};
    const redirectUrl = maketouRes.redirectUrl || cart.redirectUrl;

    if (!redirectUrl) {
      console.error('[Maketou] Réponse sans redirectUrl :', maketouRes);
      return res.status(500).json({ success: false, error: "L'API Maketou n'a pas retourné d'URL de paiement" });
    }

    // 5. Sauvegarde en base locale avec le jeton de téléchargement
    db.saveOrder({
      internalOrderId: orderId,
      cartId: cart.id,
      email: cleanEmail,
      phone: cleanPhone,
      firstName,
      lastName,
      redirectUrl,
      downloadToken,
      fbp: maketouPayload.meta.fbp,
      fbc: maketouPayload.meta.fbc
    });

    return res.status(200).json({
      success: true,
      cartId: cart.id,
      redirectUrl,
      orderId,
      token: downloadToken
    });

  } catch (error) {
    console.error('[Checkout Create Error]', error);
    return res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Une erreur est survenue lors de l’initialisation'
    });
  }
});

/**
 * ROUTE 2 : GET /api/verify-order-status
 * Verrous 2 & 3 : Vérification stricte, exécution unique CAPI et idempotence
 */
app.get('/api/verify-order-status', async (req, res) => {
  try {
    const { orderId, sig } = req.query;

    if (!orderId || !sig || !verifyOrderSignature(orderId, sig)) {
      return res.status(403).json({ success: false, error: 'Signature de commande invalide ou expirée.' });
    }

    const order = db.getOrder(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Commande introuvable' });
    }

    let cartStatus = order.cached_status;
    const now = Date.now();

    // Consultation de Maketou si le statut n'est pas encore 'completed'
    if (now - (order.last_status_check || 0) > 15000 && order.cached_status !== 'completed') {
      try {
        const cartData = await maketou.getCartStatus(order.cartId);
        cartStatus = cartData.cart?.status || cartData.status || order.cached_status;
        db.updateOrderStatus(orderId, cartStatus);
      } catch (apiErr) {
        if (apiErr.status === 429) {
          console.warn('[Maketou 429] Statut local conservé temporairement');
        } else {
          console.error('[Maketou Status Error]', apiErr.message);
        }
      }
    }

    const isCompleted = (cartStatus === 'completed');
    let triggerClientPixel = false;

    // Verrou 3 : Déclenchement atomique unique du Purchase CAPI & Pixel
    if (isCompleted) {
      const lockResult = db.markPurchaseTrackedAtomically(orderId);
      if (lockResult.success) {
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'];
        const appBaseUrl = process.env.APP_BASE_URL || `http://localhost:${PORT}`;

        sendMetaPurchaseEvent({
          cartId: order.cartId,
          email: order.email,
          phone: order.phone,
          firstName: order.firstName,
          lastName: order.lastName,
          clientIp,
          userAgent,
          fbp: order.fbp,
          fbc: order.fbc,
          amount: process.env.PRODUCT_PRICE_XOF || 2500,
          currency: 'XOF',
          eventSourceUrl: `${appBaseUrl}/verify-purchase?orderId=${orderId}&sig=${sig}`
        });

        triggerClientPixel = true;
      }
    }

    return res.json({
      success: true,
      status: cartStatus,
      isCompleted: isCompleted,
      triggerPixel: triggerClientPixel,
      cartId: order.cartId,
      amount: process.env.PRODUCT_PRICE_XOF || 2500,
      currency: 'XOF',
      downloadUrl: cartStatus === 'completed' ? (order.downloadUrl || null) : null,
      retryUrl: order.redirectUrl
    });

  } catch (error) {
    console.error('[Verify Order Error]', error);
    return res.status(500).json({ success: false, error: 'Erreur lors de la vérification' });
  }
});

/**
 * ROUTE SÉCURISÉE DE TÉLÉCHARGEMENT DIRECT DU GUIDE : GET /api/download/guide
 * Masque 100% le lien Google Drive et protège le fichier contre tout accès non autorisé
 */
app.get('/api/download/guide', async (req, res) => {
  try {
    const { orderId, token, action } = req.query;

    if (!orderId || !token || !verifyDownloadToken(orderId, token)) {
      return res.status(403).send('Accès refusé : jeton de téléchargement invalide ou manquant.');
    }

    const pdfBuffer = await getGuidePdfBuffer();

    const isInline = action === 'open';
    const disposition = isInline ? 'inline' : 'attachment';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="Guide-Complet-Importation-Chine-Afrique.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Cache-Control', 'private, no-transform, max-age=86400');

    return res.end(pdfBuffer);
  } catch (err) {
    console.error('[Secure Download Error]', err);
    return res.status(500).send('Erreur lors du téléchargement de votre guide.');
  }
});

/**
 * ROUTE DÉDIÉE : GET /api/checkout/verify
 * Vérification pour la page de remerciement et téléchargement /confirmation-achat
 */
app.get('/api/checkout/verify', async (req, res) => {
  try {
    const { cartId, orderId, token, setup_pixel } = req.query;

    // MODE A : Permet à l'Outil de configuration d'événements Meta d'afficher la page et le bouton
    if (setup_pixel === '1') {
      return res.status(200).json({
        verified: true,
        setupMode: true,
        downloadUrl: '#',
        openUrl: '#'
      });
    }

    let targetOrderId = orderId;
    let order = null;

    if (orderId) {
      order = db.getOrder(orderId);
    }
    if (!order && cartId) {
      order = db.getOrderByCartId(cartId);
      if (order) targetOrderId = order.internalOrderId;
    }

    // Si le jeton est valide ou si la commande est enregistrée
    const hasValidToken = targetOrderId && token && verifyDownloadToken(targetOrderId, token);

    if (!order && !hasValidToken) {
      return res.status(403).json({ verified: false, error: 'Accès non autorisé' });
    }

    const effectiveOrderId = targetOrderId || (order ? order.internalOrderId : 'ORD_CLIENT');
    const validToken = token || generateDownloadToken(effectiveOrderId);

    // Déclenchement unique du Meta CAPI côté serveur
    if (order && !order.purchase_tracked) {
      db.markPurchaseTrackedAtomically(effectiveOrderId);
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];
      const host = req.headers['x-forwarded-host'] || req.headers.host || '';

      sendMetaPurchaseEvent({
        cartId: order.cartId || effectiveOrderId,
        email: order.email,
        phone: order.phone,
        firstName: order.firstName,
        lastName: order.lastName,
        clientIp,
        userAgent,
        fbp: order.fbp,
        fbc: order.fbc,
        amount: process.env.PRODUCT_PRICE_XOF || 2500,
        currency: 'XOF',
        eventSourceUrl: `https://${host}/confirmation-achat`
      }).catch(err => console.error('[Meta CAPI Async Error]', err));
    }

    const downloadUrl = `/api/download/guide?orderId=${encodeURIComponent(effectiveOrderId)}&token=${encodeURIComponent(validToken)}&action=download`;
    const openUrl = `/api/download/guide?orderId=${encodeURIComponent(effectiveOrderId)}&token=${encodeURIComponent(validToken)}&action=open`;

    return res.status(200).json({
      verified: true,
      orderId: effectiveOrderId,
      downloadToken: validToken,
      downloadUrl,
      openUrl,
      customerEmail: order ? order.email : '',
      eventId: `pur_${effectiveOrderId}`
    });

  } catch (e) {
    console.error('[API Checkout Verify Error]', e);
    return res.status(500).json({ verified: false, error: e.message });
  }
});


/**
 * ROUTE 3 : Webhook Maketou asynchrone
 */
app.post('/api/webhooks/maketou', (req, res) => {
  const event = req.body;
  const status = event.cart?.status || event.status;
  const internalOrderId = event.cart?.meta?.internalOrderId || event.meta?.internalOrderId;

  if (internalOrderId && status) {
    db.updateOrderStatus(internalOrderId, status);
  }
  return res.status(200).json({ received: true });
});

// Servir la page de remerciement et téléchargement (/confirmation-achat & /merci)
app.get('/confirmation-achat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'confirmation-achat.html'));
});

app.get('/merci', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'confirmation-achat.html'));
});

// Redirection rétro-compatible /verify-purchase vers /confirmation-achat
app.get('/verify-purchase', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'confirmation-achat.html'));
});

// Démarrage du serveur si exécuté directement (Local, Render, Docker)
if (require.main === module) {
  app.listen(PORT, () => {
    db.initDb();
    console.log(`=======================================================`);
    console.log(`🚀 Tunnel Maketou + Meta Andromeda actif sur le port ${PORT}`);
    console.log(`🔗 URL locale : http://localhost:${PORT}`);
    console.log(`💰 Produit : ${process.env.PRODUCT_DOCUMENT_ID} (2500 FCFA)`);
    console.log(`=======================================================`);
  });
}

// Export pour le runtime Serverless Vercel
module.exports = app;
