const express = require("express");
const router = express.Router();
const {
  chatHandler,
  generateHandler,
  evaluateHandler,
  getAllAssessments,
} = require("../controllers/problemsolvingagentController");

// Chat proxy
router.post("/chat", chatHandler);
``
// Generate MCQs proxy
router.post("/generate-assessment", generateHandler);

// Evaluate Answer proxy
router.post("/evaluate-score", evaluateHandler);

// Get all cached assessments
router.get("/assessments", getAllAssessments);

module.exports = router;
