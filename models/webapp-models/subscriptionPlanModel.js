const mongoose = require("mongoose");

const subscriptionPlanSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  billingCycle: { type: String, enum: ["monthly", "yearly"], default: "monthly" },
  features: {
    maxTotalAttempts: { type: Number, required: true },
    maxRealModeAttempts: { type: Number, required: true },
    testModeUnlimited: { type: Boolean, default: false },
    accessToSAT: { type: Boolean, default: true },
    accessToStandard: { type: Boolean, default: true }, // ✅ ADD THIS FIELD
    advancedAnalytics: { type: Boolean, default: false },
    prioritySupport: { type: Boolean, default: false }
  },
  isActive: { type: Boolean, default: true },
  stripePriceId: { type: String }
}, { timestamps: true });

// Static method to initialize default plans
subscriptionPlanSchema.statics.initializeDefaultPlans = async function() {
  try {
    const defaultPlans = [
      {
        name: "Free",
        price: 0,
        billingCycle: "monthly",
        features: {
          maxTotalAttempts: 2,
          maxRealModeAttempts: 2,
          testModeUnlimited: false,
          accessToSAT: true,
          accessToStandard: true, // ✅ ADD THIS
          advancedAnalytics: false,
          prioritySupport: false
        },
        isActive: true
      },
      {
        name: "Basic",
        price: 9.99,
        billingCycle: "monthly",
        features: {
          maxTotalAttempts: 10,
          maxRealModeAttempts: 10,
          testModeUnlimited: false,
          accessToSAT: true,
          accessToStandard: true, // ✅ ADD THIS
          advancedAnalytics: true,
          prioritySupport: false
        },
        isActive: true
      },
      {
        name: "Premium",
        price: 19.99,
        billingCycle: "monthly",
        features: {
          maxTotalAttempts: -1,
          maxRealModeAttempts: -1,
          testModeUnlimited: false,
          accessToSAT: true,
          accessToStandard: true, // ✅ ADD THIS
          advancedAnalytics: true,
          prioritySupport: true
        },
        isActive: true
      }
    ];

    let createdCount = 0;
    let updatedCount = 0;

    for (const planData of defaultPlans) {
      const result = await this.findOneAndUpdate(
        { name: planData.name },
        planData,
        { 
          upsert: true, 
          new: true,
          setDefaultsOnInsert: true 
        }
      );
      
      if (result.isNew) {
        createdCount++;
      } else {
        updatedCount++;
      }
    }

    console.log(`✅ Subscription plans auto-initialized: ${createdCount} created, ${updatedCount} updated`);
    return true;
  } catch (error) {
    console.error("❌ Error auto-initializing subscription plans:", error);
    return false;
  }
};

// Auto-initialize when model is first used
subscriptionPlanSchema.statics.ensurePlansExist = async function() {
  const planCount = await this.countDocuments();
  if (planCount === 0) {
    console.log("🔄 No subscription plans found, auto-initializing...");
    return await this.initializeDefaultPlans();
  }
  
  // ✅ Check if existing plans have the required fields
  const plans = await this.find({});
  for (const plan of plans) {
    let needsUpdate = false;
    
    if (plan.features.maxTotalAttempts === undefined) {
      console.log(`🔄 Adding missing maxTotalAttempts to plan: ${plan.name}`);
      if (plan.name === "Free") {
        plan.features.maxTotalAttempts = 2;
      } else if (plan.name === "Basic") {
        plan.features.maxTotalAttempts = 10;
      } else if (plan.name === "Premium") {
        plan.features.maxTotalAttempts = -1;
      }
      needsUpdate = true;
    }
    
    if (plan.features.accessToStandard === undefined) {
      console.log(`🔄 Adding missing accessToStandard to plan: ${plan.name}`);
      plan.features.accessToStandard = true; // All plans get standard access
      needsUpdate = true;
    }
    
    if (needsUpdate) {
      await plan.save();
    }
  }
  
  return true;
};

const SubscriptionPlan = mongoose.model("SubscriptionPlan", subscriptionPlanSchema);

module.exports = SubscriptionPlan;