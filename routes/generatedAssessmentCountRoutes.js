const express = require("express");
const {
  getGeneratedAssessmentCount,
  getStandardAssessments,
  getSatAssessments,
  getSatAssessmentById,   
  getStandardAssessmentById,   
} = require("../controllers/generatedAssessmentCountController");

const router = express.Router();

// ✅ Counts
router.get("/count", getGeneratedAssessmentCount);

// ✅ Full list of Standard Assessments
router.get("/standard", getStandardAssessments);

// ✅ Full list of SAT Assessments
router.get("/sat", getSatAssessments);

// ✅ Single SAT Assessment by ID (for preview)
router.get("/sat/:id", getSatAssessmentById);

// ✅ Single Standard Assessment by ID (for preview)
router.get("/standard/:id", getStandardAssessmentById);

module.exports = router;
