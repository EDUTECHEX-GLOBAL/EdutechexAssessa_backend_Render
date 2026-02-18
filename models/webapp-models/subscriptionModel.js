const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Userwebapp",
    required: true
  },
  planId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SubscriptionPlan",
    required: true
  },
  status: {
    type: String,
    enum: ["active", "canceled", "past_due", "inactive"],
    required: true
  },
  stripeSubscriptionId: { type: String },
  stripeCustomerId: { type: String },
  currentPeriodStart: { type: Date, required: true },
  currentPeriodEnd: { type: Date, required: true },
  cancelAtPeriodEnd: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model("Subscription", subscriptionSchema);