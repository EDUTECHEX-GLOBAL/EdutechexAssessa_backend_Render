const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const {
  startProctoringSession,
  logProctoringViolation,
  endProctoringSession,
  getProctoringSessions,
  getProctoringSessionBySubmission
} = require("../controllers/proctoringController");

// Student routes
router.post("/start-session", protect, startProctoringSession);
router.post("/log-violation", protect, logProctoringViolation);
router.post("/end-session", protect, endProctoringSession);

// Teacher routes
router.get("/sessions/:assessmentId", protect, getProctoringSessions);
router.get("/session/submission/:submissionId", protect, getProctoringSessionBySubmission);

module.exports = router;