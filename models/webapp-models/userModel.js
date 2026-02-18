const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const userwebappSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    isAdmin: {
      type: Boolean,
      required: true,
      default: false,
    },
    isAdminApproved: {
      type: Boolean,
      default: false,
    },
    role: {
      type: String,
      required: true,
      enum: ["student", "teacher"],
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "inactive"],
      default: "pending",
    },
    rejectionReason: {
      type: String,
    },    
    pic: {
      type: String,
      required: true,
      default: "https://example.com/default-pic.png",
    },
    class: {
      type: String,
      default: "",
    },
    mobile: {
      type: String,
      default: "",
    },
    bio: {
      type: String,
      default: "",
    },
    city: {
      type: String,
      default: "",
    },
    country: {
      type: String,
      default: "",
    },
    resetPasswordToken: {
      type: String,
    },
    resetPasswordExpire: {
      type: Date,
    },

    // ✅ ADD SCHOOL FIELDS HERE (Add these 4 fields)
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SchoolAdmin",
      index: true
    },
    schoolName: {
      type: String,
      trim: true
    },
    credentialsSent: {
      type: Boolean,
      default: false
    },
    credentialsSentAt: {
      type: Date
    },
    subscription: {
      planId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SubscriptionPlan"
      },
      status: {
        type: String,
        enum: ["active", "canceled", "past_due", "inactive"],
        default: "inactive"
      },
      stripeSubscriptionId: { type: String },
      stripeCustomerId: { type: String },
      paypalSubscriptionId: { type: String },
      paypalPlanId: { type: String },
      paypalPayerId: { type: String },
      paypalPendingPrice: { type: Number },
      paypalPendingSubscriptionId: { type: String },
      paypalPendingPlanId: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionPlan" },
      currentPeriodStart: { type: Date },
      currentPeriodEnd: { type: Date },
      cancelAtPeriodEnd: { type: Boolean, default: false },
      // ✅ ADD: Track when subscription was last activated
      lastActivatedAt: { type: Date }
    },
    usage: {
      realModeAttemptsUsed: { type: Number, default: 0 },
      totalAttemptsUsed: { type: Number, default: 0 },
      lastResetDate: { type: Date, default: Date.now }
    }
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
userwebappSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ✅ Compare password for login
userwebappSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// ✅ Method to assign free plan to user
userwebappSchema.methods.assignFreePlan = async function() {
  try {
    const SubscriptionPlan = mongoose.model("SubscriptionPlan");
    
    // Ensure plans exist first
    await SubscriptionPlan.ensurePlansExist();
    
    const freePlan = await SubscriptionPlan.findOne({ name: "Free" });
    if (freePlan) {
      this.subscription.planId = freePlan._id;
      this.subscription.status = "active";
      await this.save();
      console.log(`✅ Assigned Free plan to user: ${this.email}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error assigning free plan:", error);
    return false;
  }
};

// ✅ NEW: Reset usage when subscription is activated
userwebappSchema.methods.resetUsageForPaidSubscription = async function() {
  try {
    const SubscriptionPlan = mongoose.model("SubscriptionPlan");
    const plan = await SubscriptionPlan.findById(this.subscription.planId);
    
    if (!plan) return false;
    
    // Only reset if it's a paid plan AND subscription is active
    if (plan.price > 0 && this.subscription.status === "active") {
      
      // Check if we need to reset (first time activation or new period)
      const now = new Date();
      const shouldReset = 
        !this.subscription.lastActivatedAt || 
        (this.subscription.lastActivatedAt && 
         this.subscription.lastActivatedAt.getMonth() !== now.getMonth());
      
      if (shouldReset) {
        this.usage.totalAttemptsUsed = 0;
        this.usage.realModeAttemptsUsed = 0;
        this.usage.lastResetDate = now;
        this.subscription.lastActivatedAt = now;
        
        await this.save();
        console.log(`✅ Reset usage counters for paid subscriber: ${this.email}`);
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error("Error resetting usage for paid subscription:", error);
    return false;
  }
};

// ✅ IMPROVED: Sync total attempts with automatic reset for paid users
userwebappSchema.methods.syncTotalAttempts = async function() {
  try {
    const AssessmentSubmission = mongoose.model("AssessmentSubmission");
    const SatSubmission = mongoose.model("SatSubmission");
    
    // First, check and reset usage if this is a paid subscriber
    await this.resetUsageForPaidSubscription();
    
    // Count ALL submissions regardless of mode
    const standardTotalCount = await AssessmentSubmission.countDocuments({
      studentId: this._id
    });
    
    const satTotalCount = await SatSubmission.countDocuments({
      studentId: this._id
    });
    
    const totalAttempts = standardTotalCount + satTotalCount;
    
    // Update the usage counter to match actual database state
    this.usage.totalAttemptsUsed = totalAttempts;
    await this.save();
    
    console.log(`✅ Synced total attempts for ${this.email}: ${totalAttempts} attempts`);
    return totalAttempts;
  } catch (error) {
    console.error("❌ Error syncing total attempts:", error);
    return this.usage.totalAttemptsUsed || 0;
  }
};

// Generate password reset token
userwebappSchema.methods.getResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(32).toString("hex");
  
  this.resetPasswordToken = crypto.createHash("sha256").update(resetToken).digest("hex");
  this.resetPasswordExpire = Date.now() + 3600000;

  return resetToken;
};

const Userwebapp = mongoose.model("Userwebapp", userwebappSchema);

module.exports = Userwebapp;