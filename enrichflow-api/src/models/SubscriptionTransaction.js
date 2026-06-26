const mongoose = require('mongoose');

/**
 * Subscription revenue record — one doc per paid GHL invoice.
 *
 * GHL handles billing entirely. We receive an `InvoicePaid` webhook when money
 * is collected and mirror it here so we can track MRR, plan revenue, and per-location
 * payment history.
 *
 * Lifecycle events (non-payment) like installs, upgrades, cancellations are also
 * recorded here with amountPaid = 0 so the full subscription timeline is in one place.
 */
const subscriptionTransactionSchema = new mongoose.Schema(
  {
    locationId: { type: String, index: true },
    companyId:  { type: String, index: true },
    appId:      { type: String, default: null },

    // Event type
    event: {
      type: String,
      enum: ['invoice_paid', 'invoice_partially_paid', 'new_subscription', 'renewal', 'upgrade', 'downgrade', 'cancellation', 'reactivation'],
      required: true,
      index: true
    },

    // GHL invoice fields (populated for invoice_paid events)
    invoiceId:     { type: String, default: null, index: true },
    invoiceNumber: { type: String, default: null },
    amountPaid:    { type: Number, default: 0 },
    currency:      { type: String, default: 'USD' },
    invoiceStatus: { type: String, default: null }, // 'paid', 'open', 'void' etc
    liveMode:      { type: Boolean, default: true },
    amountDue:     { type: Number, default: 0 },   // remaining balance (0 = fully paid)
    invoiceDate:   { type: Date, default: null },

    // Plan context at time of event
    planId:          { type: String, default: null },
    planName:        { type: String, default: null },
    priceUsd:        { type: Number, default: 0 },
    includedCredits: { type: Number, default: 0 },

    // For plan changes — previous plan
    previousPlanId:   { type: String, default: null },
    previousPlanName: { type: String, default: null },
    previousPriceUsd: { type: Number, default: null },

    // Subscription period this payment covers
    periodStart: { type: Date, default: null },
    periodEnd:   { type: Date, default: null },

    // Contact who paid (from invoice contactDetails)
    payerEmail: { type: String, default: null },
    payerName:  { type: String, default: null },

    // Source webhook type
    webhookType: { type: String, default: null },

    // Raw webhook payload for reconciliation / debugging
    rawData: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
);

subscriptionTransactionSchema.index({ locationId: 1, createdAt: -1 });
subscriptionTransactionSchema.index({ companyId: 1, event: 1, createdAt: -1 });
subscriptionTransactionSchema.index({ invoiceId: 1 }, { unique: true, sparse: true });

/** MRR breakdown by plan for a given month. */
subscriptionTransactionSchema.statics.getMonthlyRevenue = async function (year, month) {
  const start = new Date(year, month - 1, 1);
  const end   = new Date(year, month, 1);
  const result = await this.aggregate([
    { $match: { event: 'invoice_paid', liveMode: true, createdAt: { $gte: start, $lt: end } } },
    { $group: { _id: '$planName', count: { $sum: 1 }, revenue: { $sum: '$amountPaid' } } },
    { $sort: { revenue: -1 } }
  ]);
  const total = result.reduce((s, r) => s + r.revenue, 0);
  return { breakdown: result, total };
};

/** Recent subscription events for a location. */
subscriptionTransactionSchema.statics.getForLocation = function (locationId, limit = 10) {
  return this.find({ locationId }).sort({ createdAt: -1 }).limit(limit);
};

/** Total revenue collected for a location (all time). */
subscriptionTransactionSchema.statics.getTotalForLocation = async function (locationId) {
  const result = await this.aggregate([
    { $match: { locationId, event: 'invoice_paid' } },
    { $group: { _id: null, total: { $sum: '$amountPaid' }, count: { $sum: 1 } } }
  ]);
  return result[0] || { total: 0, count: 0 };
};

module.exports = mongoose.model('SubscriptionTransaction', subscriptionTransactionSchema);
