const mongoose = require("mongoose");

const satStudyTaskSchema = new mongoose.Schema({
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
  duration: {
    type: Number,
    required: true
  },
  priority: {
    type: Boolean,
    default: false
  },
  questionData: {
    type: mongoose.Schema.Types.Mixed
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

satStudyTaskSchema.index({ studentId: 1, isCompleted: 1 });
satStudyTaskSchema.index({ studentId: 1, topic: 1 });

const SatStudyPlan = mongoose.model("SatStudyPlan", satStudyTaskSchema);

module.exports = SatStudyPlan;
