const mongoose = require("mongoose");

const schoolStudentCSVSchema = new mongoose.Schema(
  {
    schoolAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SchoolAdmin",
      required: true,
    },
    // ✅ ADDED: Link to main Userwebapp student
    mainUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Userwebapp",
      index: true
    },
    name: {
      type: String,
      required: [true, "Student name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
    },
    grade: {
      type: String,
      required: [true, "Grade is required"],
      trim: true,
    },
    section: {
      type: String,
      trim: true,
    },
    parentEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
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
schoolStudentCSVSchema.index({ schoolAdmin: 1, email: 1 }, { unique: true });
schoolStudentCSVSchema.index({ schoolAdmin: 1, status: 1 });
schoolStudentCSVSchema.index({ email: 1 });
// ✅ ADDED: Index for mainUserId for faster lookups
schoolStudentCSVSchema.index({ mainUserId: 1 });

const SchoolStudentCSV = mongoose.model("SchoolStudentCSV", schoolStudentCSVSchema);
module.exports = SchoolStudentCSV;