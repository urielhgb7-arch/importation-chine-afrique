/**
 * Base de données transactionnelle avec persistance atomique
 * Gère les commandes, les verrous d'idempotence (10 min), le cache anti-rate-limit 429
 * et le verrou atomique de déduplication Purchase pour Meta Ads CAPI / Pixel.
 */
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'orders_store.json');

function initDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ orders: {}, idempotency: {} }, null, 2), 'utf-8');
  }
}

function readData() {
  initDb();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return { orders: {}, idempotency: {} };
  }
}

function writeData(data) {
  const tempFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempFile, DB_FILE);
}

// Verrou 1 : Recherche d'un panier idempotent existant (fenêtre de 15 min)
function getIdempotentOrder(idempotencyKey) {
  const data = readData();
  const entry = data.idempotency[idempotencyKey];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > 15 * 60 * 1000) {
    return null;
  }
  return data.orders[entry.orderId] || null;
}

// Enregistrement d'une commande
function saveOrder(order) {
  const data = readData();
  data.orders[order.internalOrderId] = {
    ...order,
    purchase_tracked: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
    cached_status: 'waiting_payment',
    last_status_check: 0
  };
  if (order.idempotencyKey) {
    data.idempotency[order.idempotencyKey] = {
      orderId: order.internalOrderId,
      timestamp: Date.now()
    };
  }
  writeData(data);
  return data.orders[order.internalOrderId];
}

// Récupération de commande par internalOrderId
function getOrder(orderId) {
  const data = readData();
  return data.orders[orderId] || null;
}

// Mise à jour du cache de statut du panier Maketou
function updateOrderStatus(orderId, status) {
  const data = readData();
  if (data.orders[orderId]) {
    data.orders[orderId].cached_status = status;
    data.orders[orderId].last_status_check = Date.now();
    data.orders[orderId].updated_at = Date.now();
    writeData(data);
  }
}

// Verrou 3 : Marquer purchase_tracked = 1 de manière atomique
function markPurchaseTrackedAtomically(orderId) {
  const data = readData();
  const order = data.orders[orderId];
  if (!order) return { success: false, reason: 'order_not_found' };
  if (order.purchase_tracked === 1) {
    return { success: false, reason: 'already_tracked' };
  }
  order.purchase_tracked = 1;
  order.tracked_at = Date.now();
  writeData(data);
  return { success: true };
}

module.exports = {
  initDb,
  getIdempotentOrder,
  saveOrder,
  getOrder,
  updateOrderStatus,
  markPurchaseTrackedAtomically
};
