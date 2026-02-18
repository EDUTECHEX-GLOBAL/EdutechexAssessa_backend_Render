const express = require("express");
const router = express.Router();
const {
  getAllStandardAttemptsForAdmin,
  getAllSatAttemptsForAdmin,
  getStudentPerformanceProfile,
} = require("../controllers/studentAttemptedAssessmentsController");
const { protect, admin } = require("../middlewares/authMiddleware");

// If only admins should view these, add `adminOnly`
router.get("/standard", protect, getAllStandardAttemptsForAdmin);
router.get("/sat", protect,  getAllSatAttemptsForAdmin);
router.get("/student/:studentId", protect, admin, getStudentPerformanceProfile); 

module.exports = router;
