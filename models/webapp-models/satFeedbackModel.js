// backend/models/webapp-models/satFeedbackModel.js
const mongoose = require("mongoose");

const satFeedbackSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Userwebapp",
      required: true,
    },
    assessmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SatAssessment",
      required: true,
    },
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SatSubmission",
      required: true,
    },
    assessmentType: {
      type: String,
      enum: ["sat"],
      default: "sat",
    },
    feedbackText: {
      type: String, // store JSON string or plain string
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Userwebapp",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SatFeedback", satFeedbackSchema);
