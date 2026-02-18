// assessmentuploadformModel.js
const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  options: [{ type: String, required: true }],
  correctAnswer: { type: Number, required: true },
  marks: { type: Number, default: 1 },
  type: {
    type: String,
    enum: ["mcq", "truefalse", "gridin", "paragraph"],
    default: "mcq"
  },
  fromAI: { type: Boolean, default: false }
});

const assessmentSchema = new mongoose.Schema({
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Teacher",
    required: true
  },
   schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SchoolAdmin",
    index: true
  },
  assessmentName: { type: String, required: true },
  subject: { type: String, required: true },
  gradeLevel: { type: String, required: true },
  fileUrl: { type: String },
  questions: [questionSchema],
  difficulty: { 
    type: String,
    enum: ["easy", "medium", "hard", "very hard"],
    required: true
  },
  timeLimit: { type: Number, default: 30 },
  isApproved: { type: Boolean, default: false },

  // 🆕 ENHANCEMENTS
  status: {
    type: String,
    enum: ["draft", "published", "archived"],
    default: "draft"
  },
  tags: [{ type: String }], // e.g., ["algebra", "geometry"]
  estimatedTime: { type: Number }, // minutes
  rating: {
    average: { type: Number, default: 0 },
    count: { type: Number, default: 0 }
  },

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("AssessmentUpload", assessmentSchema);
