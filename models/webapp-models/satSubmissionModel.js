const mongoose = require("mongoose");

const satResponseSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  options: { type: [String] }, // Optional for grid-in questions
  correctAnswer: { type: mongoose.Schema.Types.Mixed, required: true }, // Can be Number or String
  studentAnswer: { type: mongoose.Schema.Types.Mixed, required: true }, // Can be Number or String
  isCorrect: { type: Boolean, required: true },
  marks: { type: Number, required: true },
  type: { type: String, enum: ['mcq', 'grid_in'], required: true },
}, { _id: false });

const satSubmissionSchema = new mongoose.Schema({
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

  schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SchoolAdmin",
      index: true
  },
  responses: [satResponseSchema],
  score: { type: Number, required: true },
  totalMarks: { type: Number, required: true },
  percentage: { type: Number, required: true },
  timeTaken: { type: Number, required: true },
  submittedAt: { type: Date, default: Date.now },

  proctoringSessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ProctoringSession"
  },
  proctoringData: {
    mode: { type: String, enum: ['test', 'real'] },
    violationCount: { type: Number, default: 0 },
    sessionDuration: { type: Number } // in seconds
  }
}, { timestamps: true });

// ✅ AUTO-SYNC TOTAL ATTEMPTS WHEN SAT SUBMISSIONS ARE DELETED
satSubmissionSchema.post('deleteOne', { document: true, query: false }, async function() {
  try {
    const Userwebapp = mongoose.model("Userwebapp");
    const user = await Userwebapp.findById(this.studentId);
    if (user) {
      console.log(`🔄 Auto-syncing TOTAL attempts after SAT deletion for user: ${user.email}`);
      await user.syncTotalAttempts();
    }
  } catch (error) {
    console.error("❌ Error auto-syncing after SAT deletion:", error);
  }
});

// Handle deleteMany operations for SAT submissions
satSubmissionSchema.post('deleteMany', async function(result) {
  try {
    console.log("🔄 Bulk SAT deletion detected - consider running manual sync");
  } catch (error) {
    console.error("❌ Error handling bulk SAT deletion sync:", error);
  }
});

module.exports = mongoose.model("SatSubmission", satSubmissionSchema);