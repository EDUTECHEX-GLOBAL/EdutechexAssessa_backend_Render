const express = require("express");
const router = express.Router();
const { protect, schoolAdmin } = require("../middlewares/authMiddleware");
const {
  getSchoolAttempts,
  getAttemptStats,
  getAttemptDetails
} = require("../controllers/schoolAttemptsController");

// All routes require school admin authentication
router.use(protect, schoolAdmin);

// Get all assessment attempts for the school
router.get("/", getSchoolAttempts);

// Get attempt statistics for dashboard
router.get("/stats", getAttemptStats);

// Get detailed view of a specific attempt
router.get("/:id", getAttemptDetails);

module.exports = router;