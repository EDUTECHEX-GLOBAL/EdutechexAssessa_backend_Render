const express = require("express");
const {
  getSubscriptionPlans,
  getMySubscription,
  trackAssessmentAttempt,
  resetAttemptCount,
  debugSubscription // ✅ ADD THIS
} = require("../controllers/subscriptionController");
const {
  createPayPalSubscription,
  capturePayPalSubscription,
} = require("../controllers/paypalController");
const { protect } = require("../middlewares/authMiddleware");

const router = express.Router();

// Existing routes
router.get("/plans", protect, getSubscriptionPlans);
router.get("/my-subscription", protect, getMySubscription);
router.post("/track-attempt", protect, trackAssessmentAttempt);
router.post("/reset-attempts", protect, resetAttemptCount);

// ✅ ADD DEBUG ROUTE
router.get("/debug", protect, debugSubscription);

// PayPal routes
router.post("/create-paypal-subscription", protect, createPayPalSubscription);
router.post("/capture-paypal-subscription", protect, capturePayPalSubscription);

module.exports = router;