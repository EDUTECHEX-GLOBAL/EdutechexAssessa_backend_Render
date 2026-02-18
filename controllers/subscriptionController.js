const asyncHandler = require("express-async-handler");
const Userwebapp = require("../models/webapp-models/userModel");
const SubscriptionPlan = require("../models/webapp-models/subscriptionPlanModel");

// Get available subscription plans
const getSubscriptionPlans = asyncHandler(async (req, res) => {
  try {
    // Ensure plans exist before fetching and fix any missing fields
    await SubscriptionPlan.ensurePlansExist();
    
    const plans = await SubscriptionPlan.find({ isActive: true });
    res.json(plans);
  } catch (error) {
    console.error("Error fetching subscription plans:", error);
    res.status(500).json({ message: "Failed to fetch subscription plans" });
  }
});

// Get user's current subscription with proper usage reset
const getMySubscription = asyncHandler(async (req, res) => {
  try {
    const user = await Userwebapp.findById(req.user._id).populate("subscription.planId");
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Ensure user has a subscription plan
    if (!user.subscription.planId) {
      await user.assignFreePlan();
      const updatedUser = await Userwebapp.findById(req.user._id).populate("subscription.planId");
      user.subscription = updatedUser.subscription;
    }

    // ✅ CRITICAL: Reset usage for paid subscribers on every check
    await user.resetUsageForPaidSubscription();

    const usage = await getUserUsage(req.user._id);
    
    res.json({
      subscription: user.subscription,
      usage: usage,
      canAttemptRealMode: await canUserAttemptRealMode(req.user._id),
      canAttemptAssessment: await canUserAttemptAssessment(req.user._id)
    });
  } catch (error) {
    console.error("Error fetching user subscription:", error);
    res.status(500).json({ message: "Failed to fetch subscription data" });
  }
});

// Improved subscription checking with paid user priority
const canUserAttemptAssessment = async (userId) => {
  try {
    const user = await Userwebapp.findById(userId).populate("subscription.planId");
    
    if (!user) {
      console.log("❌ User not found");
      return false;
    }

    // Ensure user has a plan
    if (!user.subscription.planId) {
      await user.assignFreePlan();
      const updatedUser = await Userwebapp.findById(userId).populate("subscription.planId");
      user.subscription = updatedUser.subscription;
      user.usage = updatedUser.usage;
    }

    const plan = user.subscription.planId;
    
    if (!plan) {
      console.log("❌ No plan found for user");
      return false;
    }

    // ✅ FIX: Handle missing maxTotalAttempts field with proper fallback
    const maxTotalAttempts = plan.features.maxTotalAttempts !== undefined 
      ? plan.features.maxTotalAttempts 
      : (plan.name === "Free" ? 2 : plan.name === "Basic" ? 10 : -1);

    console.log(`🔍 Assessment Check - User: ${user.email}, Plan: ${plan.name}, Status: ${user.subscription.status}, Price: ${plan.price}, TotalUsed: ${user.usage.totalAttemptsUsed}, MaxTotal: ${maxTotalAttempts}`);

    // ✅ PRIORITY 1: Check if user has active PAID subscription
    if (user.subscription.status === "active" && plan.price > 0) {
      // For paid subscribers, usage should be reset automatically
      await user.resetUsageForPaidSubscription();
      
      // Check plan features for unlimited access
      if (maxTotalAttempts === -1) {
        console.log("✅ Premium user - unlimited attempts");
        return true; // Unlimited for Premium
      }
      
      // For Basic plan with limited attempts
      const canAttempt = user.usage.totalAttemptsUsed < maxTotalAttempts;
      console.log(`🔍 Basic Plan Check - Used: ${user.usage.totalAttemptsUsed}, Max: ${maxTotalAttempts}, CanAttempt: ${canAttempt}`);
      return canAttempt;
    }

    // ✅ PRIORITY 2: Free users or inactive subscriptions
    // Reset counter if it's a new month
    const now = new Date();
    const lastReset = new Date(user.usage.lastResetDate);
    if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
      user.usage.totalAttemptsUsed = 0;
      user.usage.lastResetDate = now;
      await user.save();
      console.log("🔄 Reset monthly counters for free user");
    }

    // Check free tier limits
    const canAttempt = user.usage.totalAttemptsUsed < maxTotalAttempts;
    console.log(`🔍 Free User Check - Used: ${user.usage.totalAttemptsUsed}, Max: ${maxTotalAttempts}, CanAttempt: ${canAttempt}`);
    
    return canAttempt;
  } catch (error) {
    console.error("Error checking assessment eligibility:", error);
    return false;
  }
};

// Real mode checking (similar improvement)
const canUserAttemptRealMode = async (userId) => {
  try {
    const user = await Userwebapp.findById(userId).populate("subscription.planId");
    
    if (!user) return false;

    if (!user.subscription.planId) {
      await user.assignFreePlan();
      const updatedUser = await Userwebapp.findById(userId).populate("subscription.planId");
      user.subscription = updatedUser.subscription;
      user.usage = updatedUser.usage;
    }

    const plan = user.subscription.planId;
    
    if (!plan) return false;

    // ✅ FIX: Handle missing maxRealModeAttempts field
    const maxRealModeAttempts = plan.features.maxRealModeAttempts !== undefined 
      ? plan.features.maxRealModeAttempts 
      : (plan.name === "Free" ? 2 : plan.name === "Basic" ? 10 : -1);

    // ✅ Reset usage for paid subscribers first
    if (user.subscription.status === "active" && plan.price > 0) {
      await user.resetUsageForPaidSubscription();
      
      if (maxRealModeAttempts === -1) {
        return true;
      }
      
      return user.usage.realModeAttemptsUsed < maxRealModeAttempts;
    }

    // Monthly reset for free users
    const now = new Date();
    const lastReset = new Date(user.usage.lastResetDate);
    if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
      user.usage.realModeAttemptsUsed = 0;
      user.usage.lastResetDate = now;
      await user.save();
    }

    return user.usage.realModeAttemptsUsed < maxRealModeAttempts;
  } catch (error) {
    console.error("Error checking Real Mode eligibility:", error);
    return false;
  }
};

// Track assessment attempt
const trackAssessmentAttempt = asyncHandler(async (req, res) => {
  try {
    const user = await Userwebapp.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Sync attempts with automatic reset for paid users
    await user.syncTotalAttempts();
    
    const canContinue = await canUserAttemptAssessment(req.user._id);
    
    res.json({ 
      totalAttemptsUsed: user.usage.totalAttemptsUsed,
      canContinue: canContinue,
      message: canContinue 
        ? `You have used ${user.usage.totalAttemptsUsed} of ${user.subscription.planId?.features?.maxTotalAttempts || 2} attempts this month`
        : "You've reached your attempt limit for this month"
    });
  } catch (error) {
    console.error("Error tracking assessment attempt:", error);
    res.status(500).json({ message: "Failed to track assessment attempt" });
  }
});

// Get user usage
const getUserUsage = async (userId) => {
  try {
    const user = await Userwebapp.findById(userId);
    if (!user) return null;

    // Ensure usage is reset for paid subscribers
    await user.resetUsageForPaidSubscription();

    const canAttemptRealMode = await canUserAttemptRealMode(userId);
    const canAttemptAssessment = await canUserAttemptAssessment(userId);
    let plan = user.subscription.planId;
    
    if (!plan) {
      await SubscriptionPlan.ensurePlansExist();
      plan = await SubscriptionPlan.findOne({ name: "Free" });
    }

    // ✅ FIX: Handle missing fields with proper fallback
    const maxTotalAttempts = plan?.features?.maxTotalAttempts !== undefined 
      ? plan.features.maxTotalAttempts 
      : (plan?.name === "Free" ? 2 : plan?.name === "Basic" ? 10 : -1);

    const maxRealModeAttempts = plan?.features?.maxRealModeAttempts !== undefined 
      ? plan.features.maxRealModeAttempts 
      : (plan?.name === "Free" ? 2 : plan?.name === "Basic" ? 10 : -1);

    return {
      realModeAttemptsUsed: user.usage.realModeAttemptsUsed,
      totalAttemptsUsed: user.usage.totalAttemptsUsed,
      maxRealModeAttempts: maxRealModeAttempts,
      maxTotalAttempts: maxTotalAttempts,
      canAttemptRealMode: canAttemptRealMode,
      canAttemptAssessment: canAttemptAssessment,
      testModeUnlimited: plan?.features?.testModeUnlimited || false,
      resetDate: user.usage.lastResetDate,
      subscriptionStatus: user.subscription.status,
      planName: plan?.name || "Free"
    };
  } catch (error) {
    console.error("Error getting user usage:", error);
    return null;
  }
};

// Reset user's attempt count (for testing/admin purposes)
const resetAttemptCount = asyncHandler(async (req, res) => {
  try {
    const user = await Userwebapp.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.usage.realModeAttemptsUsed = 0;
    user.usage.totalAttemptsUsed = 0;
    user.usage.lastResetDate = new Date();
    await user.save();

    const usage = await getUserUsage(req.user._id);
    
    res.json({ 
      message: "Attempt count reset successfully",
      usage: usage,
      canAttemptRealMode: await canUserAttemptRealMode(req.user._id),
      canAttemptAssessment: await canUserAttemptAssessment(req.user._id)
    });
  } catch (error) {
    console.error("Error resetting attempt count:", error);
    res.status(500).json({ message: "Failed to reset attempt count" });
  }
});

// ✅ ADD DEBUG ENDPOINT
const debugSubscription = asyncHandler(async (req, res) => {
  try {
    const user = await Userwebapp.findById(req.user._id).populate("subscription.planId");
    
    console.log("🔍 DEBUG SUBSCRIPTION DATA:");
    console.log("User ID:", user._id);
    console.log("Email:", user.email);
    console.log("Subscription Status:", user.subscription.status);
    console.log("Plan ID:", user.subscription.planId?._id);
    console.log("Plan Name:", user.subscription.planId?.name);
    console.log("Plan Price:", user.subscription.planId?.price);
    console.log("Plan Features:", user.subscription.planId?.features);
    console.log("Usage - totalAttemptsUsed:", user.usage.totalAttemptsUsed);
    console.log("Usage - realModeAttemptsUsed:", user.usage.realModeAttemptsUsed);
    console.log("Last Reset Date:", user.usage.lastResetDate);
    console.log("Last Activated At:", user.subscription.lastActivatedAt);
    
    const canAttempt = await canUserAttemptAssessment(user._id);
    console.log("Can attempt assessment:", canAttempt);
    
    res.json({
      subscription: user.subscription,
      usage: user.usage,
      canAttemptAssessment: canAttempt,
      planFeatures: user.subscription.planId?.features,
      debug: {
        userId: user._id,
        email: user.email,
        subscriptionStatus: user.subscription.status,
        planName: user.subscription.planId?.name,
        planPrice: user.subscription.planId?.price,
        totalAttemptsUsed: user.usage.totalAttemptsUsed,
        maxTotalAttempts: user.subscription.planId?.features?.maxTotalAttempts,
        canAttempt: canAttempt,
        lastActivatedAt: user.subscription.lastActivatedAt
      }
    });
  } catch (error) {
    console.error("Debug error:", error);
    res.status(500).json({ message: "Debug failed", error: error.message });
  }
});

module.exports = {
  getSubscriptionPlans,
  getMySubscription,
  canUserAttemptRealMode,
  canUserAttemptAssessment,
  trackAssessmentAttempt,
  getUserUsage,
  resetAttemptCount,
  debugSubscription
};