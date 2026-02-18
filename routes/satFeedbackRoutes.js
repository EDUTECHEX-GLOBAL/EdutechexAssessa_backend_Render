// satFeedbackRoutes.js (add getAllFeedbacks import)
const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const {
  generateFeedback,
  saveGeneratedFeedback,
  generateAndSaveFeedback,
  getFeedbacksByStudent,
  getAllFeedbacks, // <-- NEW
} = require("../controllers/satFeedbackController");

// Get all SAT feedbacks (teacher/admin)
router.get("/", protect, getAllFeedbacks);

// Generate feedback (AI only, not saved)
router.post("/generate", protect, generateFeedback);

// Save feedback manually
router.post("/save", protect, saveGeneratedFeedback);

// Generate & save in one go
router.post("/send", protect, generateAndSaveFeedback);

// Get all feedback for a student (student view)
router.get("/student", protect, getFeedbacksByStudent);

module.exports = router;
