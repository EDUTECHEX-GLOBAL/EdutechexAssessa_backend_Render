const express = require("express");
const router = express.Router();
const multer = require("multer");
const {
  registerSchoolAdmin,
  authSchoolAdmin,
  getSchoolAdminProfile,
  updateSchoolAdminProfile,
  updateSchoolAdminPassword,
  getDashboardStats,
} = require("../controllers/schoolAdminController");

// Import CSV controllers
const {
  bulkUploadStudents,
  getSchoolStudents,
  toggleStudentStatus,
  getStudentDetails,
  deleteStudent
} = require("../controllers/schoolStudentCSVController");

const {
  getAssessmentAnalytics,
  getStudentPerformance,
  getUserEngagement,
  getUsageTrends,
  exportReports
} = require("../controllers/schoolReportsController");

const {
  bulkUploadTeachers,
  getSchoolTeachers,
  toggleTeacherStatus,
  getTeacherDetails,
  deleteTeacher
} = require("../controllers/schoolTeacherCSVController");

// ✅ Import school attempts controller
const {
  getSchoolAttempts,
  getAttemptStats,
  getAttemptDetails
} = require("../controllers/schoolAttemptsController");

const {
  getSchoolAdminNotifications,
  markNotificationAsRead,
  markAllAsRead,
  getUnreadCount
} = require("../controllers/schoolAdminNotificationController");

// ✅ Import school uploads controller (COMPLETE - includes exportAssessmentPDF)
const {
  getSchoolUploads,
  getUploadStats,
  getUploadDetails,
  exportAssessmentPDF  // ✅ INCLUDED FOR PDF EXPORT
} = require("../controllers/schooluploadscontroller");

const { protect, schoolAdmin } = require("../middlewares/authMiddleware");

// Configure multer for CSV uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"), false);
    }
  }
});

// ✅ Debug middleware
router.use((req, res, next) => {
  console.log(`🎯 School Admin Route: ${req.method} ${req.originalUrl}`);
  console.log(`📁 File: ${req.file ? req.file.originalname : 'No file'}`);
  console.log(`👤 User: ${req.user ? req.user._id : 'No user'}`);
  next();
});

// ========== PUBLIC ROUTES ==========
router.post("/register", registerSchoolAdmin);
router.post("/login", authSchoolAdmin);

// ✅ Test route (can be removed after testing)
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "School Admin API is working!",
    routes: {
      dashboard: "GET /api/school-admin/dashboard/stats",
      studentUpload: "POST /api/school-admin/bulk-upload/students",
      teacherUpload: "POST /api/school-admin/bulk-upload/teachers",
      attempts: "GET /api/school-admin/attempts",
      attemptStats: "GET /api/school-admin/attempts/stats",
      teacherUploads: "GET /api/school-admin/uploads",
      uploadStats: "GET /api/school-admin/uploads/stats",
      uploadExport: "GET /api/school-admin/uploads/:id/export" // ✅ INCLUDED
    }
  });
});

// ========== PROTECTED ROUTES ==========
// 🔒 All routes below require school admin authentication
router.use(protect, schoolAdmin);

// 📊 Dashboard Route
router.get("/dashboard/stats", getDashboardStats);

// 👤 Profile Management
router.route("/profile")
  .get(getSchoolAdminProfile)
  .put(updateSchoolAdminProfile);

router.put("/profile/password", updateSchoolAdminPassword);

// 👥 Student Management
router.post("/bulk-upload/students", upload.single("csvFile"), bulkUploadStudents);
router.get("/students", getSchoolStudents);
router.get("/students/:id", getStudentDetails);
router.patch("/students/:id/toggle-status", toggleStudentStatus);
router.delete("/students/:id", deleteStudent);

// 👩‍🏫 Teacher Management
router.post("/bulk-upload/teachers", upload.single("csvFile"), bulkUploadTeachers);
router.get("/teachers", getSchoolTeachers);
router.get("/teachers/:id", getTeacherDetails);
router.patch("/teachers/:id/toggle-status", toggleTeacherStatus);
router.delete("/teachers/:id", deleteTeacher);

// ✅ Assessment Attempts Management
// GET /api/school-admin/attempts?type=all&page=1&limit=20&startDate=...
router.get("/attempts", getSchoolAttempts);

// GET /api/school-admin/attempts/stats
router.get("/attempts/stats", getAttemptStats);

// GET /api/school-admin/attempts/:id
router.get("/attempts/:id", getAttemptDetails);

// ✅ Teacher-Generated Assessments Management
// GET /api/school-admin/uploads?type=all&page=1&limit=20&status=approved
router.get("/uploads", getSchoolUploads);

// GET /api/school-admin/uploads/stats
router.get("/uploads/stats", getUploadStats);

// GET /api/school-admin/uploads/:id
router.get("/uploads/:id", getUploadDetails);

// ✅ PDF Export Route - THIS WAS MISSING!
router.get("/uploads/:id/export", exportAssessmentPDF);

// 🔔 Notification Management
router.get("/notifications", getSchoolAdminNotifications);
router.get("/notifications/unread-count", getUnreadCount);
router.patch("/notifications/:id/read", markNotificationAsRead);
router.patch("/notifications/mark-all-read", markAllAsRead);
// 📊 Reports Routes
router.get("/reports/assessment-analytics", getAssessmentAnalytics);
router.get("/reports/student-performance", getStudentPerformance);
router.get("/reports/user-engagement", getUserEngagement);
router.get("/reports/usage-trends", getUsageTrends);
router.get("/reports/export", exportReports);

module.exports = router;