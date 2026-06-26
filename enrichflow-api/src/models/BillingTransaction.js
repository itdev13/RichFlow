const mongoose = require('mongoose');

/**
 * Every wallet charge sent to GHL — one doc per charge call.
 * Included-credit usage is free and NOT recorded here; only overage charges that
 * hit the GHL wallet appear as billing transactions.
 */
const billingTransactionSchema = new mongoose.Schema(
  {
    locationId:  { type: String, required: true, index: true },
    companyId:   { type: String, required: true, index: true },

    // type of event that triggered the charge
    type: {
      type: String,
      enum: ['enrichment_overage', 'bulk_enrichment_overage', 'workflow_enrichment_overage', 'manual'],
      default: 'enrichment_overage'
    },

    // GHL charge response
    ghlChargeId: { type: String, default: null },

    // reference to the enrichment record that caused this charge
    enrichmentRecordId: { type: mongoose.Schema.Types.ObjectId, ref: 'EnrichmentRecord', default: null },

    // credit + money breakdown
    credits:     { type: Number, required: true }, // overage credits charged
    rateUsd:     { type: Number, required: true }, // per-credit rate used
    amountUsd:   { type: Number, required: true }, // credits * rateUsd

    // plan context at time of charge
    planId:      { type: String, default: null },
    planName:    { type: String, default: null },

    status: {
      type: String,
      enum: ['charged', 'failed', 'skipped', 'billing_disabled'],
      default: 'charged'
    },

    errorMessage: { type: String, default: null },

    // description sent to GHL
    description: { type: String, default: null }
  },
  { timestamps: true }
);

billingTransactionSchema.index({ locationId: 1, createdAt: -1 });
billingTransactionSchema.index({ companyId: 1, status: 1, createdAt: -1 });

billingTransactionSchema.statics.getRecent = function (locationId, limit = 20) {
  return this.find({ locationId }).sort({ createdAt: -1 }).limit(limit);
};

billingTransactionSchema.statics.getMonthlySpend = async function (locationId) {
  const start = new Date();
  start.setDate(1); start.setHours(0, 0, 0, 0);
  const result = await this.aggregate([
    { $match: { locationId, status: 'charged', createdAt: { $gte: start } } },
    { $group: { _id: null, total: { $sum: '$amountUsd' }, credits: { $sum: '$credits' } } }
  ]);
  return result[0] || { total: 0, credits: 0 };
};

module.exports = mongoose.model('BillingTransaction', billingTransactionSchema);
