const mongoose = require("mongoose");

const satQuestionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['mcq', 'grid_in'],
    required: true,
  },
  questionText: { 
    type: String, 
    required: true,
    trim: true
  },
  passage: { 
    type: String,
    trim: true
  },
  options: [{ 
    type: String,
    trim: true
  }],
  correctAnswer: { 
    type: mongoose.Schema.Types.Mixed,
    required: true,
    validate: {
      validator: function(value) {
        if (this.type === 'mcq') {
          return Number.isInteger(value) && value >= 0 && value < this.options.length;
        }
        return true; // grid_in can be any string/number
      },
      message: 'MCQ correctAnswer must be a valid option index (0-3)'
    }
  },
  marks: { 
    type: Number, 
    default: 1,
    min: 1,
    max: 10
  },
  questionNumber: { 
    type: Number 
  },
  // New fields for validation
  fromAI: {
    type: Boolean,
    default: false
  },
  verified: {
    type: Boolean,
    default: false
  },
  templateType: {
    type: String,
    default: ''
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard', 'very hard']
  },
  sectionType: {
    type: String,
    enum: ['reading', 'writing', 'math_no_calc', 'math_calc', 'mixed'] // ADDED 'mixed'
  },
  validationScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 100
  },
  lastValidated: {
    type: Date,
    default: Date.now
  },
  // 🔥 NEW: For jumbled question tracking
  originalAssessmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SatAssessment"
  },
  originalQuestionIndex: {
    type: Number
  }
}, { 
  _id: true,
  timestamps: true 
});

const satAssessmentSchema = new mongoose.Schema({
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Teacher",
    required: true,
    index: true
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SchoolAdmin",
    index: true
  },
  satTitle: { 
    type: String, 
    required: true,
    trim: true
  },
  sectionType: {
    type: String,
    enum: ['reading', 'writing', 'math_no_calc', 'math_calc', 'all', 'mixed'], // ADDED 'mixed'
    required: true,
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard', 'very hard'],
    required: true
  },
  questions: [satQuestionSchema],
  fileUrl: { 
    type: String,
    trim: true
  },
  isApproved: { 
    type: Boolean, 
    default: false,
    index: true
  },

  // Enhanced fields
  status: {
    type: String,
    enum: ["draft", "published", "archived", "needs_review"],
    default: "draft"
  },
  tags: [{ 
    type: String,
    trim: true
  }],
  estimatedTime: { 
    type: Number,
    min: 1,
    max: 180
  },
  rating: {
    average: { 
      type: Number, 
      default: 0,
      min: 0,
      max: 5
    },
    count: { 
      type: Number, 
      default: 0,
      min: 0
    }
  },
  
  // Math validation stats
  mathValidation: {
    totalMathQuestions: {
      type: Number,
      default: 0
    },
    verifiedMathQuestions: {
      type: Number,
      default: 0
    },
    verificationScore: {
      type: Number,
      default: 100,
      min: 0,
      max: 100
    },
    needsReview: {
      type: Boolean,
      default: false
    }
  },
  
  // Generation metadata
  generatedBy: {
    type: String,
    enum: ['ai-only', 'math-first', 'hybrid', 'manual', 'jumbled'], // ADDED 'jumbled'
    default: 'hybrid'
  },
  fileType: {
    type: String,
    enum: ['pdf', 'markdown', 'jumbled'], // ADDED 'jumbled'
    default: 'pdf'
  },

  // 🔥 NEW: For jumbled assessments
  isJumbled: {
    type: Boolean,
    default: false,
    index: true
  },
  sourceAssessments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "SatAssessment"
  }],

  createdAt: { 
    type: Date, 
    default: Date.now,
    index: true
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  },
  publishedAt: { 
    type: Date 
  }
});

// Indexes for better query performance
satAssessmentSchema.index({ teacherId: 1, createdAt: -1 });
satAssessmentSchema.index({ schoolId: 1, status: 1 });
satAssessmentSchema.index({ sectionType: 1, difficulty: 1 });
satAssessmentSchema.index({ "questions.verified": 1 });
satAssessmentSchema.index({ isJumbled: 1 }); // NEW index

// Pre-save hook for validation
satAssessmentSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  if (this.isModified('questions')) {
    // Count math questions and verified ones
    const mathQuestions = this.questions.filter(q => 
      q.sectionType && (q.sectionType.includes('math') || q.sectionType === 'mixed')
    );
    
    const verifiedMath = mathQuestions.filter(q => q.verified === true);
    
    this.mathValidation = {
      totalMathQuestions: mathQuestions.length,
      verifiedMathQuestions: verifiedMath.length,
      verificationScore: mathQuestions.length > 0 
        ? Math.round((verifiedMath.length / mathQuestions.length) * 100)
        : 100,
      needsReview: mathQuestions.length > 0 && verifiedMath.length < mathQuestions.length
    };
    
    // Update generatedBy based on verification
    if (mathQuestions.length > 0 && verifiedMath.length === mathQuestions.length) {
      this.generatedBy = 'math-first';
    }
    
    // For jumbled assessments, all questions are already verified
    if (this.isJumbled) {
      this.generatedBy = 'jumbled';
      this.fileType = 'jumbled';
    }
    
    // Validate each question
    for (let i = 0; i < this.questions.length; i++) {
      const q = this.questions[i];
      
      if (q.type === 'mcq') {
        // Ensure correctAnswer is a valid index
        if (typeof q.correctAnswer !== 'number' || 
            q.correctAnswer < 0 || 
            q.correctAnswer >= (q.options || []).length) {
          throw new Error(
            `Question ${i + 1} has invalid correctAnswer index: ${q.correctAnswer}. ` +
            `Must be between 0 and ${(q.options || []).length - 1}.`
          );
        }
        
        // Quick math check for math questions
        if (q.questionText && /[0-9+\-*/=]/.test(q.questionText) && q.options) {
          const correctOption = q.options[q.correctAnswer];
          // Check if option contains numbers (most math answers do)
          if (correctOption && !/\d/.test(correctOption)) {
            console.warn(`Question ${i + 1}: Marked answer "${correctOption}" doesn't contain numbers`);
            this.status = "needs_review";
          }
        }
      }
    }
  }
  
  next();
});

// Instance method to check math validation
satAssessmentSchema.methods.getMathValidationStatus = function() {
  const mathQuestions = this.questions.filter(q => 
    q.sectionType && (q.sectionType.includes('math') || q.sectionType === 'mixed')
  );
  
  if (mathQuestions.length === 0) {
    return {
      status: 'no_math',
      score: 100,
      message: 'No math questions in this assessment'
    };
  }
  
  const verified = mathQuestions.filter(q => q.verified === true).length;
  const score = Math.round((verified / mathQuestions.length) * 100);
  
  let status = 'excellent';
  let message = `All ${mathQuestions.length} math questions are verified`;
  
  if (score < 100) {
    status = score >= 80 ? 'good' : score >= 60 ? 'fair' : 'poor';
    message = `${verified}/${mathQuestions.length} math questions verified (${score}%)`;
  }
  
  if (this.mathValidation.needsReview) {
    status = 'needs_review';
    message = 'Some math questions need review';
  }
  
  return { status, score, message, total: mathQuestions.length, verified };
};

// Static method to find assessments needing math review
satAssessmentSchema.statics.findNeedingMathReview = function(teacherId) {
  return this.find({
    teacherId,
    'mathValidation.needsReview': true,
    isApproved: false,
    status: { $ne: 'archived' }
  }).sort({ createdAt: -1 });
};

// Static method to get standard question counts by difficulty
satAssessmentSchema.statics.getStandardQuestionCount = function(difficulty) {
  const counts = {
    'easy': 20,
    'medium': 25,
    'hard': 30,
    'very hard': 35
  };
  return counts[difficulty] || 25;
};

module.exports = mongoose.model("SatAssessment", satAssessmentSchema);