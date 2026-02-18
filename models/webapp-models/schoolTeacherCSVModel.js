const mongoose = require("mongoose");

const schoolTeacherCSVSchema = new mongoose.Schema(
  {
    schoolAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SchoolAdmin",
      required: true,
    },
    // ✅ ADDED: Link to main Teacher model
    mainUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      index: true
    },
    name: {
      type: String,
      required: [true, "Teacher name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
    },
    subject: {
      type: String,
      required: [true, "Subject is required"],
      trim: true,
    },
    qualification: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    experience: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "active", "inactive", "rejected"],
      default: "pending",
    },
    credentialsSent: {
      type: Boolean,
      default: false,
    },
    credentialsSentAt: {
      type: Date,
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
    rejectionReason: {
      type: String,
    },
    temporaryPassword: {
      type: String,
    },
    lastLogin: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Create index for efficient queries
schoolTeacherCSVSchema.index({ schoolAdmin: 1, email: 1 }, { unique: true });
schoolTeacherCSVSchema.index({ schoolAdmin: 1, status: 1 });
schoolTeacherCSVSchema.index({ email: 1 });
// ✅ ADDED: Index for mainUserId for faster lookups
schoolTeacherCSVSchema.index({ mainUserId: 1 });

const SchoolTeacherCSV = mongoose.model("SchoolTeacherCSV", schoolTeacherCSVSchema);
module.exports = SchoolTeacherCSV;