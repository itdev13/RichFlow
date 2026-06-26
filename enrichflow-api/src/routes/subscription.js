const express = require('express');
const router = express.Router();
const subscriptionService = require('../services/subscriptionService');
const BillingTransaction = require('../models/BillingTransaction');
const SubscriptionTransaction = require('../models/SubscriptionTransaction');
const logger = require('../utils/logger');

/**
 * GET /api/subscription/status?locationId=...
 * Entitlement + plan + monthly included-credit usage for the dashboard / gating.
 */
router.get('/status', async (req, res) => {
  const { locationId } = req.query;
  if (!locationId) return res.status(400).json({ success: false, error: 'locationId is required' });
  try {
    const status = await subscriptionService.getStatus(locationId);
    return res.json({ success: true, ...status });
  } catch (err) {
    logger.error('Subscription status failed', { message: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/subscription/transactions?locationId=...&limit=20
 * Billing transaction history for the Usage dashboard.
 */
router.get('/transactions', async (req, res) => {
  const { locationId, limit = 20 } = req.query;
  if (!locationId) return res.status(400).json({ success: false, error: 'locationId is required' });
  try {
    const transactions = await BillingTransaction.getRecent(locationId, Number(limit));
    const monthly = await BillingTransaction.getMonthlySpend(locationId);
    return res.json({ success: true, transactions, monthlySpend: monthly });
  } catch (err) {
    logger.error('Transactions fetch failed', { message: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/subscription/history?locationId=...
 * Full subscription timeline for a location — installs, plan changes, invoices paid.
 */
router.get('/history', async (req, res) => {
  const { locationId, limit = 10 } = req.query;
  if (!locationId) return res.status(400).json({ success: false, error: 'locationId is required' });
  try {
    const [history, totals] = await Promise.all([
      SubscriptionTransaction.getForLocation(locationId, Number(limit)),
      SubscriptionTransaction.getTotalForLocation(locationId)
    ]);
    return res.json({ success: true, history, totals });
  } catch (err) {
    logger.error('Subscription history failed', { message: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/subscription/revenue?year=2026&month=6
 * Monthly recurring revenue breakdown by plan — admin/analytics use.
 */
router.get('/revenue', async (req, res) => {
  const now = new Date();
  const year  = Number(req.query.year  || now.getFullYear());
  const month = Number(req.query.month || now.getMonth() + 1);
  try {
    const { breakdown, total } = await SubscriptionTransaction.getMonthlyRevenue(year, month);
    return res.json({ success: true, year, month, total, breakdown });
  } catch (err) {
    logger.error('Revenue fetch failed', { message: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/subscription/dev-activate  { locationId, companyId? }
 * Local-testing helper — simulates the INSTALL/subscription-active state so you can exercise the
 * mandatory-subscription gate without a live GHL install. Disabled in production.
 */
router.post('/dev-activate', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, error: 'Disabled in production' });
  }
  const { locationId, companyId } = req.body || {};
  if (!locationId) return res.status(400).json({ success: false, error: 'locationId is required' });
  try {
    const sub = await subscriptionService.activate({ locationId, companyId, status: 'active' });
    return res.json({ success: true, subscription: sub });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
