const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema({
  topic: { type: String },
  tags: [{ type: String }],

  score: { type: Number, required: true },
  total: { type: Number, required: true },
  percentage: { type: Number },

  feedbackText: { type: String, required: true },

  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Userwebapp",
    required: true,
  },
  assessmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "AssessmentUpload",
    required: true,
  },

  source: {
    type: String,
    enum: ["manual", "ai"],
    default: "ai",
  },

  fromAIQuestions: { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now },
});

// ✅ Enforce uniqueness: one feedback per student per assessment
feedbackSchema.index({ studentId: 1, assessmentId: 1 }, { unique: true });

module.exports = mongoose.model("Feedback", feedbackSchema);
