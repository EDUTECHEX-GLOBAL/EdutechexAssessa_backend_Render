// backend/routes/satAssessmentRoutes.js

const express = require("express");
const router = express.Router();
const multer = require("multer");
const { protect } = require("../middlewares/authMiddleware");

// import controllers
const {
  uploadSATAssessment,
  getMySATAssessments,
  deleteSATAssessment,
  getSatAssessmentCount,
  getAllSATAssessmentsForStudents,
  getSatAssessmentForAttempt,
  getSatAssessmentSubmissions,
  submitSatAssessment,
  getMySatSubmissions,
  getMySATAssessmentsForReview,
  approveSATAssessment,
  getSatStudentProgress,
  getMySatProgress,
  validateSATAlignment,
  // 🔥 ADD THESE 3 NEW CONTROLLER FUNCTIONS
  testMathGeneration,
  validateMathQuestions,
  fixMathQuestion,
  // 🔥 NEW JUMBLING FUNCTIONS
  createJumbledAssessment,
  previewJumbledAssessment,
  getAssessmentsForJumbling,
  getJumbledAssessments
} = require("../controllers/satAssessmentController");

const SatAssessment = require("../models/webapp-models/satAssessmentModel");

// Use in-memory storage since you're parsing the buffer directly
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ==================== EXISTING ROUTES ====================

// POST /api/sat-assessments/upload
router.post("/upload", protect, upload.single("file"), uploadSATAssessment);
// POST submission route (must be placed before `/:id` routes to avoid conflicts)
router.post("/:id/submit", protect, submitSatAssessment);

// GET all SAT assessments uploaded by a teacher (review panel)
router.get("/teacher/all", protect, getMySATAssessmentsForReview);

// Teacher progress tracking for SAT
router.get("/teacher/student-progress", protect, getSatStudentProgress);

// Student progress (detailed rows for SatProgress.jsx)
router.get("/my-progress", protect, getMySatProgress);

// PATCH approve SAT assessment
router.patch("/:id/approve", protect, approveSATAssessment);

// GET /api/sat-assessments/library
router.get("/library", protect, getMySATAssessments);
router.get("/library/count", protect, getSatAssessmentCount);
router.get("/all", protect, getAllSATAssessmentsForStudents);

// GET /api/sat-assessments/:id/attempt (Student attempts SAT assessment)
router.get("/:id/attempt", protect, getSatAssessmentForAttempt);
// Teacher views all SAT submissions for an assessment
router.get("/:id/submissions", protect, getSatAssessmentSubmissions);
router.get("/my-submissions", protect, getMySatSubmissions);

// DELETE /api/sat-assessments/:id
router.delete("/:id", protect, deleteSATAssessment);

// ==================== 🔥 NEW MATH-FIRST ROUTES ====================

// 🧪 Test math-first generation (for teacher to verify before upload)
router.post("/test/math-generation", protect, testMathGeneration);

// 📊 Validate math questions in a specific assessment
router.post("/:id/validate-math", protect, validateMathQuestions);

// 🔧 Fix a specific math question
router.put("/:id/questions/:questionIndex/fix", protect, fixMathQuestion);

// ✅ Validate SAT difficulty alignment
router.post("/:id/validate-sat-alignment", protect, validateSATAlignment);

// 👁️ Get assessments needing math review
router.get("/teacher/needs-review", protect, async (req, res) => {
  try {
    const assessments = await SatAssessment.find({
      teacherId: req.user._id,
      'mathValidation.needsReview': true,
      isApproved: false,
      status: { $ne: 'archived' }
    }).sort({ createdAt: -1 });
    
    // Add validation status to each assessment
    const enhancedAssessments = assessments.map(assessment => ({
      ...assessment._doc,
      mathValidationStatus: assessment.getMathValidationStatus()
    }));
    
    res.json(enhancedAssessments);
  } catch (err) {
    console.error('❌ Error fetching assessments needing review:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch assessments needing review' 
    });
  }
});

// 📈 Get math validation statistics for teacher dashboard
router.get("/teacher/math-stats", protect, async (req, res) => {
  try {
    const teacherId = req.user._id;
    
    const stats = await SatAssessment.aggregate([
      { $match: { teacherId: teacherId } },
      {
        $group: {
          _id: null,
          totalAssessments: { $sum: 1 },
          totalMathQuestions: { $sum: "$mathValidation.totalMathQuestions" },
          verifiedMathQuestions: { $sum: "$mathValidation.verifiedMathQuestions" },
          needsReviewCount: {
            $sum: {
              $cond: [{ $eq: ["$mathValidation.needsReview", true] }, 1, 0]
            }
          },
          averageVerificationScore: {
            $avg: "$mathValidation.verificationScore"
          }
        }
      }
    ]);
    
    res.json({
      success: true,
      stats: stats[0] || {
        totalAssessments: 0,
        totalMathQuestions: 0,
        verifiedMathQuestions: 0,
        needsReviewCount: 0,
        averageVerificationScore: 100
      }
    });
  } catch (err) {
    console.error('❌ Error fetching math stats:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch math statistics' 
    });
  }
});

// ==================== 🔥 NEW JUMBLING FEATURE ROUTES ====================

// GET assessments available for jumbling (filter by difficulty)
router.get("/available-for-jumbling", protect, getAssessmentsForJumbling);

// POST preview jumbled assessment
router.post("/jumble/preview", protect, previewJumbledAssessment);

// POST create jumbled assessment
router.post("/jumble", protect, createJumbledAssessment);

// GET jumbled assessments created by teacher
router.get("/jumbled/list", protect, getJumbledAssessments);

module.exports = router;