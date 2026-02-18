const express = require("express");
const router = express.Router();

const {
  generateFeedback,
  saveGeneratedFeedback,
  getAllFeedbacks,
  getFeedbacksByStudent,
  generateAndSaveFeedback, // ✅ added
} = require("../controllers/feedbackController");

const { protect } = require("../middlewares/authMiddleware");

// ✅ Unified endpoint for teacher dashboard (used by ProgressTracking.jsx)
router.post("/send", protect, generateAndSaveFeedback);

// Optional: Separate endpoints
router.post("/generate", protect, generateFeedback); // generate only
router.post("/save", protect, saveGeneratedFeedback); // save only

// Student endpoint
router.get("/student", protect, getFeedbacksByStudent);

// All feedbacks (admin/debug)
router.get("/", protect, getAllFeedbacks);

module.exports = router;
