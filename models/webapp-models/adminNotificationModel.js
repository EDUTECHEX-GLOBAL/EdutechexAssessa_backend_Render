const mongoose = require("mongoose");

const adminNotificationSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        "login_request",
        "assessment_uploaded", 
        "assessment_taken",
        "approval_approved",
        "approval_rejected",
        "system_alert"
      ],
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    data: {
      // Flexible field for storing related IDs or additional data
      userId: mongoose.Schema.Types.ObjectId,
      teacherId: mongoose.Schema.Types.ObjectId,
      assessmentId: mongoose.Schema.Types.ObjectId,
      submissionId: mongoose.Schema.Types.ObjectId,
      role: String, // 'student' or 'teacher'
      assessmentType: String, // 'standard' or 'sat'
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
adminNotificationSchema.index({ adminId: 1, isRead: 1, createdAt: -1 });
adminNotificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model("AdminNotification", adminNotificationSchema);