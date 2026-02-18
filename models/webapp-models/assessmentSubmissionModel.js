const mongoose = require("mongoose");

const responseSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  options: { type: [String], required: true },
  correctAnswer: { type: Number, required: true },
  studentAnswer: { type: Number, required: true },
  isCorrect: { type: Boolean, required: true },
  marks: { type: Number, required: true },
  topic: { type: String }, // optional, useful for feedback AI
});

const assessmentSubmissionSchema = new mongoose.Schema({
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

  schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SchoolAdmin",
      index: true
  },
  responses: [responseSchema], // ✅ Replaces 'answers'
  score: { type: Number, required: true },
  totalMarks: { type: Number, required: true },
  percentage: { type: Number, required: true },
  timeTaken: { type: Number, required: true }, // Seconds
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
});

// ✅ AUTO-SYNC TOTAL ATTEMPTS WHEN SUBMISSIONS ARE DELETED
assessmentSubmissionSchema.post('deleteOne', { document: true, query: false }, async function() {
  try {
    const Userwebapp = mongoose.model("Userwebapp");
    const user = await Userwebapp.findById(this.studentId);
    if (user) {
      console.log(`🔄 Auto-syncing TOTAL attempts after deletion for user: ${user.email}`);
      await user.syncTotalAttempts();
    }
  } catch (error) {
    console.error("❌ Error auto-syncing after deletion:", error);
  }
});

// Handle deleteMany operations
assessmentSubmissionSchema.post('deleteMany', async function(result) {
  try {
    console.log("🔄 Bulk deletion detected - consider running manual sync for affected users");
  } catch (error) {
    console.error("❌ Error handling bulk deletion sync:", error);
  }
});

module.exports = mongoose.model("AssessmentSubmission", assessmentSubmissionSchema);