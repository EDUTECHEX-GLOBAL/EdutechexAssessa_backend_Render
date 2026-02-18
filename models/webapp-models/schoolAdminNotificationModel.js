const mongoose = require("mongoose");

const schoolAdminNotificationSchema = new mongoose.Schema(
  {
    schoolAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SchoolAdmin",
      required: true,
      index: true
    },
    type: {
      type: String,
      required: true,
      enum: [
        "new_student_added",
        "new_teacher_added",
        "student_login",
        "teacher_login",
        "assessment_generated",
        "assessment_attempted",
        "feedback_sent",
        "credentials_resent"
      ]
    },
    title: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true
    },
    data: {
      type: Object,
      default: {}
    },
    read: {
      type: Boolean,
      default: false
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium"
    },
    relatedUserId: {
      type: mongoose.Schema.Types.ObjectId
    },
    relatedAssessmentId: {
      type: mongoose.Schema.Types.ObjectId
    },
    relatedSubmissionId: {
      type: mongoose.Schema.Types.ObjectId
    }
  },
  { timestamps: true }
);

// Indexes for efficient queries
schoolAdminNotificationSchema.index({ schoolAdminId: 1, read: 1 });
schoolAdminNotificationSchema.index({ schoolAdminId: 1, createdAt: -1 });

const SchoolAdminNotification = mongoose.model(
  "SchoolAdminNotification",
  schoolAdminNotificationSchema
);

module.exports = SchoolAdminNotification;