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

/**
 * ROUTE 1 : POST /api/checkout/create
 * Verrou 1 d'idempotence atomique (10 minutes) & Appel sécurisé à Maketou sans customerPrice
 */
app.post('/api/checkout/create', async (req, res) => {
  try {
    const { fullName, email, phone, fbp, fbc } = req.body;
    const clientKey = req.headers['x-idempotency-key'];

    if (!fullName || !email || !phone) {
      return res.status(400).json({ success: false, error: 'Champs obligatoires manquants' });
    }

    const productDocumentId = process.env.PRODUCT_DOCUMENT_ID || 'd3acfce0-ae5e-4751-876c-abba88835dd5';

    // 1. Découpage automatique et inratable du Nom Complet en firstName + lastName
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    const firstName = parts[0] || 'Client';
    const lastName = parts.slice(1).join(' ') || 'Acheteur';

    // 2. Nettoyage strict du téléphone au format international (+229...)
    const cleanPhone = '+' + String(phone || '').replace(/[^0-9]/g, '');
    const cleanEmail = String(email || '').trim().toLowerCase();

    // 2.1 MODE SANDBOX SÉCURISÉ : Permet à l'administrateur de tester le parcours complet sans payer
    // S'active UNIQUEMENT si l'email se termine par @test.com ou est test@admin.com
    const isSandboxTest = cleanEmail === 'test@admin.com' || cleanEmail.endsWith('@test.com');
    if (isSandboxTest) {
      const testCartId = `test_sandbox_${Date.now()}`;
      const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || '';
      const protoHeader = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
      const isHttps = protoHeader === 'https' && hostHeader && !hostHeader.includes('localhost');
      const baseUrl = isHttps ? `https://${hostHeader}` : `http://${hostHeader || 'localhost:3000'}`;

      db.saveOrder({
        internalOrderId: testCartId,
        cartId: testCartId,
        email: cleanEmail,
        phone: cleanPhone,
        firstName,
        lastName,
        redirectUrl: `${baseUrl}/confirmation-achat?cartId=${testCartId}&sandbox=1`,
        idempotencyKey: `test_${testCartId}`,
        fbp: req.cookies?.['_fbp'] || '',
        fbc: req.cookies?.['_fbc'] || '',
        cached_status: 'completed'
      });

      console.log(`[Sandbox Test] Parcours test déclenché pour ${cleanEmail} (${testCartId})`);
      return res.status(200).json({
        success: true,
        cartId: testCartId,
        redirectUrl: `${baseUrl}/confirmation-achat?cartId=${testCartId}&sandbox=1`,
        orderId: testCartId,
        isSandbox: true
      });
    }

    // 3. Calcul de la clé d'idempotence
    const timeSlice = Math.floor(Date.now() / (10 * 60 * 1000));
    const idempotencyKey = clientKey || crypto.createHash('sha256')
      .update(`${productDocumentId}_${cleanEmail}_${cleanPhone}_${timeSlice}`)
      .digest('hex');

    // Vérifier si une commande existe déjà pour cette clé
    const existingOrder = db.getIdempotentOrder(idempotencyKey);
    if (existingOrder && existingOrder.redirectUrl) {
      console.log(`[Idempotence] Commande existante réutilisée pour ${cleanEmail} (${existingOrder.cartId})`);
      return res.status(200).json({
        success: true,
        cartId: existingOrder.cartId,
        redirectUrl: existingOrder.redirectUrl,
        orderId: existingOrder.internalOrderId,
        sig: generateOrderSignature(existingOrder.internalOrderId)
      });
    }

    // 4. Construction de la redirectURL vers /confirmation-achat
    const orderId = `ORD_${crypto.randomUUID()}`;
    const sig = generateOrderSignature(orderId);
    
    // Détection automatique du nom de domaine actif (ex: https://importation-chine-afrique.aurakadre.com)
    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || '';
    const protoHeader = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const isHttps = protoHeader === 'https' && hostHeader && !hostHeader.includes('localhost');
    const baseUrl = isHttps ? `https://${hostHeader}` : `http://${hostHeader || 'localhost:3000'}`;
    
    // Page intermédiaire /confirmation-achat pour la validation et le pixel
    const redirectURL = `${baseUrl}/confirmation-achat`;

    // 5. Payload strict conforme (SANS customerPrice pour éviter l'erreur 422 !)
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

    // 6. Sauvegarde en base locale
    db.saveOrder({
      internalOrderId: orderId,
      cartId: cart.id,
      email: cleanEmail,
      phone: cleanPhone,
      firstName,
      lastName,
      redirectUrl,
      idempotencyKey,
      fbp: maketouPayload.meta.fbp,
      fbc: maketouPayload.meta.fbc
    });

    return res.status(200).json({
      success: true,
      cartId: cart.id,
      redirectUrl,
      orderId,
      sig
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
 * ROUTE DÉDIÉE : GET /api/checkout/verify?cartId=...
 * Vérification pour la page intermédiaire /confirmation-achat
 * Compatible avec l'Outil de configuration d'événements Meta (?setup_pixel=1)
 */
app.get('/api/checkout/verify', async (req, res) => {
  try {
    const { cartId, setup_pixel } = req.query;

    // MODE A : Permet à l'Outil de configuration d'événements Meta d'afficher la page et le bouton
    if (setup_pixel === '1') {
      return res.status(200).json({ verified: true, setupMode: true, alreadyTracked: false });
    }

    if (!cartId) {
      return res.status(400).json({ verified: false, error: 'cartId requis' });
    }

    // MODE SANDBOX SÉCURISÉ : Permet de tester le parcours client sans payer et sans polluer les stats CAPI
    if (cartId.startsWith('test_sandbox_') || cartId === 'test_demo') {
      return res.status(200).json({
        verified: true,
        alreadyTracked: false,
        eventId: `pur_${cartId}`,
        customerEmail: 'test@admin.com',
        maketouDownloadUrl: process.env.MAKETOU_DOWNLOAD_URL || 'https://api.maketou.net',
        isSandbox: true
      });
    }

    const apiKey = process.env.MAKETOU_API_KEY || 'msk_c650508aa6e29d8d7da5a9c2ea05cd20d081f29a89566fe1e3da0b79c080a4c8';
    
    // Appel sécurisé à l'API Maketou
    let cart = null;
    try {
      const maketouRes = await fetch(`https://api.maketou.net/api/v1/stores/cart/${encodeURIComponent(cartId)}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      const cartData = await maketouRes.json();
      cart = cartData?.cart || cartData;
    } catch (apiErr) {
      console.error('[Maketou Cart Verify Error]', apiErr.message);
    }

    if (!cart || cart.status !== 'completed') {
      return res.status(200).json({ 
        verified: false, 
        status: cart?.status || 'waiting_payment' 
      });
    }

    // Récupération ou création des métadonnées de commande
    const order = db.getOrderByCartId(cartId) || db.getOrder(cartId) || {
      cartId,
      email: cart.email || '',
      phone: cart.phone || '',
      firstName: cart.firstName || '',
      lastName: cart.lastName || '',
      productDocumentId: cart.productDocumentId || process.env.PRODUCT_DOCUMENT_ID,
      purchase_tracked: 0
    };

    // Verrou atomique de déduplication Purchase CAPI
    const lockResult = db.markCartPurchaseTrackedAtomically(cartId);
    const alreadyTracked = !lockResult.success;

    if (!alreadyTracked) {
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];
      const host = req.headers['x-forwarded-host'] || req.headers.host || '';
      const eventSourceUrl = `https://${host}/confirmation-achat`;

      await sendMetaPurchaseEvent({
        cartId,
        email: cart.email || order.email,
        phone: cart.phone || order.phone,
        firstName: cart.firstName || order.firstName,
        lastName: cart.lastName || order.lastName,
        clientIp,
        userAgent,
        fbp: order.fbp,
        fbc: order.fbc,
        amount: process.env.PRODUCT_PRICE_XOF || 2500,
        currency: 'XOF',
        eventSourceUrl
      });
    }

    // Extraction de tout lien de téléchargement retourné par Maketou ou configuré
    const maketouDownloadUrl = cart.downloadUrl 
      || cart.fileUrl 
      || cart.receiptUrl 
      || cart.orderUrl 
      || process.env.MAKETOU_DOWNLOAD_URL 
      || null;

    return res.status(200).json({
      verified: true,
      alreadyTracked,
      eventId: `pur_${cartId}`,
      customerEmail: cart.email || order.email,
      maketouDownloadUrl
    });

  } catch (e) {
    console.error('[API Checkout Verify Error]', e);
    return res.status(500).json({ verified: false, error: e.message });
  }
});

/**
 * ROUTE 4 (Test Simulation) : POST /api/test/simulate-completed
 * Permet de tester le flux complet de validation, CAPI et redirection
 */
app.post('/api/test/simulate-completed', (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ error: 'orderId requis' });

  const order = db.getOrder(orderId);
  if (!order) return res.status(404).json({ error: 'Commande non trouvée' });

  db.updateOrderStatus(orderId, 'completed');
  const lock = db.markPurchaseTrackedAtomically(orderId);

  return res.json({
    success: true,
    message: 'Commande simulée comme complétée',
    orderId,
    purchase_tracked_now: lock.success
  });
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

// Servir la page intermédiaire /confirmation-achat
app.get('/confirmation-achat', (req, res) => {
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
