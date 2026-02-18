const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const {
  getStudyPlan,
  getPracticeQuestions,
  updateStudyTask,
  getStudyProgress,
  validateSummary  // Add the new function
} = require("../controllers/studyPlanController");

// Existing routes
router.get("/:studentId", protect, getStudyPlan);
router.get("/practice-questions/:topic", protect, getPracticeQuestions);
router.put("/task/:taskId", protect, updateStudyTask);
router.get("/progress/:studentId", protect, getStudyProgress);

// New route for summary validation
router.post("/validate-summary", protect, validateSummary);

module.exports = router;
