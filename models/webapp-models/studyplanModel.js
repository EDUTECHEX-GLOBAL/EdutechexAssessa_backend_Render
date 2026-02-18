const mongoose = require("mongoose");

const studyTaskSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Userwebapp",
    required: true
  },
  taskId: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    enum: ["concept", "remediation", "practice"],
    required: true
  },
  topic: {
    type: String,
    required: true
  },
  subject: {
    type: String,
    required: true
  },
  isCompleted: {
    type: Boolean,
    default: false
  },
  completedAt: {
    type: Date
  },
  notes: {
    type: String
  },
  // Additional fields for tracking
  duration: {
    type: Number, // in minutes
    required: true
  },
  priority: {
    type: Boolean,
    default: false
  },
  // Reference to original question if remediation task
  questionData: {
    type: mongoose.Schema.Types.Mixed
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for faster queries
studyTaskSchema.index({ studentId: 1, isCompleted: 1 });
studyTaskSchema.index({ studentId: 1, topic: 1 });

const StudyPlan = mongoose.model("StudyPlan", studyTaskSchema);

module.exports = StudyPlan;