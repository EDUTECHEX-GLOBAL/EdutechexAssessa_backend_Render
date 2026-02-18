const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");

const {
  getStudyPlan,
  getPracticeQuestions,
  updateStudyTask,
  getStudyProgress,
  validateSummary
} = require("../controllers/satStudyPlanController");

router.get("/:studentId", protect, getStudyPlan);
router.get("/practice/:topic", protect, getPracticeQuestions);
router.patch("/task/:taskId", protect, updateStudyTask);
router.get("/progress/:studentId", protect, getStudyProgress);
router.post("/validate-summary", protect, validateSummary);

module.exports = router;
