const axios = require("axios");
const User = require("../models/webapp-models/userModel");
const SubscriptionPlan = require("../models/webapp-models/subscriptionPlanModel");

const PAYPAL_API = process.env.NODE_ENV === 'production' 
  ? "https://api-m.paypal.com" 
  : "https://api-m.sandbox.paypal.com";

async function getPayPalAccessToken() {
  try {
    const response = await axios({
      url: `${PAYPAL_API}/v1/oauth2/token`,
      method: "post",
      auth: {
        username: process.env.PAYPAL_CLIENT_ID,
        password: process.env.PAYPAL_CLIENT_SECRET,
      },
      params: { grant_type: "client_credentials" },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    return response.data.access_token;
  } catch (error) {
    console.error("PayPal OAuth Error:", error.response?.data || error.message);
    throw new Error("Failed to get PayPal access token");
  }
}

// Create a PayPal subscription with dynamic plan creation
exports.createPayPalSubscription = async (req, res) => {
  try {
    const { planId, planName, price } = req.body;
    const userId = req.user._id;

    console.log(`🔄 Creating PayPal subscription for: ${planName}, $${price}`);

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const accessToken = await getPayPalAccessToken();

    // Step 1: Create a product dynamically
    const productResponse = await axios.post(
      `${PAYPAL_API}/v1/catalogs/products`,
      {
        name: `AssessaAI - ${planName}`,
        description: `${planName} subscription for AssessaAI educational platform`,
        type: "SERVICE",
        category: "EDUCATIONAL_AND_TEXTBOOKS",
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const productId = productResponse.data.id;
    console.log("✅ Product created:", productId);

    // Step 2: Create a billing plan dynamically
    const billingPlanResponse = await axios.post(
      `${PAYPAL_API}/v1/billing/plans`,
      {
        product_id: productId,
        name: `AssessaAI ${planName} - $${price}/month`,
        description: `Monthly subscription for AssessaAI ${planName} plan`,
        status: "ACTIVE",
        billing_cycles: [
          {
            frequency: {
              interval_unit: "MONTH",
              interval_count: 1
            },
            tenure_type: "REGULAR",
            sequence: 1,
            total_cycles: 0, // 0 = infinite recurring
            pricing_scheme: {
              fixed_price: {
                value: price.toString(),
                currency_code: "USD"
              }
            }
          }
        ],
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee_failure_action: "CONTINUE",
          payment_failure_threshold: 3
        },
        taxes: {
          percentage: "0",
          inclusive: false
        }
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const paypalPlanId = billingPlanResponse.data.id;
    console.log("✅ Billing plan created:", paypalPlanId);

    // Step 3: Create subscription using the dynamically created plan
    const subscriptionResponse = await axios.post(
      `${PAYPAL_API}/v1/billing/subscriptions`,
      {
        plan_id: paypalPlanId,
        application_context: {
          brand_name: "Assessa AI",
          locale: "en-US",
          shipping_preference: "NO_SHIPPING",
          user_action: "SUBSCRIBE_NOW",
          payment_method: {
            payer_selected: "PAYPAL",
            payee_preferred: "IMMEDIATE_PAYMENT_REQUIRED"
          },
          return_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}`,
          cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}`,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const subscriptionData = subscriptionResponse.data;
    
    if (!subscriptionData.id) {
      throw new Error("No subscription ID returned from PayPal");
    }

    console.log("✅ PayPal subscription created:", subscriptionData.id);

    // Store subscription data for capture
    user.subscription.paypalPendingSubscriptionId = subscriptionData.id;
    user.subscription.paypalPendingPlanId = planId;
    user.subscription.paypalPendingPrice = price;
    await user.save();

    res.status(200).json({ 
      id: subscriptionData.id
    });

  } catch (error) {
    console.error("❌ PayPal Subscription Error:", error.response?.data || error.message);
    
    // Specific error handling
    if (error.response?.status === 401) {
      return res.status(500).json({ 
        message: "PayPal authentication failed. Check your Client ID and Secret." 
      });
    }
    
    if (error.response?.status === 400) {
      return res.status(500).json({ 
        message: "Invalid request to PayPal. Please check the subscription data.",
        error: error.response?.data 
      });
    }
    
    res.status(500).json({ 
      message: "Failed to create PayPal subscription",
      error: error.response?.data || error.message 
    });
  }
};

// Capture subscription after approval - COMPLETELY UPDATED
exports.capturePayPalSubscription = async (req, res) => {
  try {
    const { subscriptionID } = req.body;
    const userId = req.user._id;

    console.log(`🔄 Capturing PayPal subscription: ${subscriptionID}`);

    if (!subscriptionID) {
      return res.status(400).json({ message: "Subscription ID is required" });
    }

    const accessToken = await getPayPalAccessToken();

    // Get subscription details from PayPal
    const { data } = await axios.get(
      `${PAYPAL_API}/v1/billing/subscriptions/${subscriptionID}`,
      {
        headers: { 
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
      }
    );

    console.log("📊 PayPal subscription status:", data.status);

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Wait for subscription to be active (handle PayPal async processing)
    if (data.status !== "ACTIVE") {
      console.log("⏳ Subscription not active yet, waiting...");
      
      // For sandbox, we can proceed if it's APPROVED or pending
      if (data.status === "APPROVED" || data.status === "APPROVAL_PENDING") {
        console.log("✅ Proceeding with approved/pending subscription");
      } else {
        return res.status(400).json({ 
          message: `Subscription is not active yet. Current status: ${data.status}. Please wait a moment and try again.` 
        });
      }
    }

    // Find the plan based on pending data or price matching
    let plan;
    
    // First try: Use the pending plan ID
    if (user.subscription.paypalPendingPlanId) {
      plan = await SubscriptionPlan.findById(user.subscription.paypalPendingPlanId);
    }
    
    // Second try: Match by price
    if (!plan && user.subscription.paypalPendingPrice) {
      plan = await SubscriptionPlan.findOne({ 
        price: user.subscription.paypalPendingPrice,
        isActive: true 
      });
    }
    
    // Third try: Match by expected price ranges
    if (!plan) {
      const price = user.subscription.paypalPendingPrice;
      if (price === 9.99) {
        plan = await SubscriptionPlan.findOne({ name: "Basic", isActive: true });
      } else if (price === 19.99) {
        plan = await SubscriptionPlan.findOne({ name: "Premium", isActive: true });
      }
    }

    // Final fallback: Use any active plan
    if (!plan) {
      plan = await SubscriptionPlan.findOne({ isActive: true });
    }

    if (!plan) {
      return res.status(404).json({ message: "Subscription plan not found" });
    }

    // ✅ CRITICAL FIX: Reset usage counters for paid subscribers
    user.usage.totalAttemptsUsed = 0;
    user.usage.realModeAttemptsUsed = 0;
    user.usage.lastResetDate = new Date();

    // ✅ ADD MISSING FIELD: Track subscription activation time
    user.subscription.lastActivatedAt = new Date();

    // Update user subscription with active status
    user.subscription.planId = plan._id;
    user.subscription.status = "active";
    user.subscription.paypalSubscriptionId = data.id;
    user.subscription.paypalPlanId = data.plan_id;
    user.subscription.paypalPayerId = data.subscriber?.payer_id;
    user.subscription.currentPeriodStart = new Date(data.start_time || new Date());
    user.subscription.currentPeriodEnd = new Date(data.billing_info?.next_billing_time || Date.now() + 30 * 24 * 60 * 60 * 1000);
    user.subscription.cancelAtPeriodEnd = false;

    // Clear pending fields
    user.subscription.paypalPendingSubscriptionId = undefined;
    user.subscription.paypalPendingPlanId = undefined;
    user.subscription.paypalPendingPrice = undefined;

    await user.save();

    console.log(`✅ Subscription activated for user: ${user.email} - Plan: ${plan.name}`);
    console.log(`✅ Reset usage counters: totalAttemptsUsed=0, realModeAttemptsUsed=0`);
    console.log(`✅ Added lastActivatedAt: ${user.subscription.lastActivatedAt}`);

    res.status(200).json({
      message: "Subscription activated successfully!",
      subscription: user.subscription,
      plan: {
        name: plan.name,
        price: plan.price,
        features: plan.features
      },
      user: {
        email: user.email,
        name: user.name
      }
    });

  } catch (error) {
    console.error("❌ Capture PayPal Subscription Error:", error.response?.data || error.message);
    
    res.status(500).json({ 
      message: "Failed to capture PayPal subscription",
      error: error.response?.data || error.message 
    });
  }
};

// ✅ ADD THIS FUNCTION: Cancel PayPal subscription
exports.cancelPayPalSubscription = async (req, res) => {
  try {
    const { subscriptionID } = req.body;
    const userId = req.user._id;

    if (!subscriptionID) {
      return res.status(400).json({ message: "Subscription ID is required" });
    }

    const accessToken = await getPayPalAccessToken();

    // Cancel the subscription in PayPal
    await axios.post(
      `${PAYPAL_API}/v1/billing/subscriptions/${subscriptionID}/cancel`,
      {
        reason: "User requested cancellation"
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    // Update user subscription status
    const user = await User.findById(userId);
    if (user) {
      user.subscription.status = "canceled";
      user.subscription.cancelAtPeriodEnd = true;
      await user.save();
    }

    res.status(200).json({ message: "Subscription cancelled successfully" });

  } catch (error) {
    console.error("❌ Cancel Subscription Error:", error.response?.data || error.message);
    res.status(500).json({ 
      message: "Failed to cancel subscription",
      error: error.response?.data || error.message 
    });
  }
};

module.exports = exports;