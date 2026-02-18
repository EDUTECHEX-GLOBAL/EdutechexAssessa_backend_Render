const express = require("express");
const router = express.Router();
const multer = require("multer");
const {
  bulkUploadTeachers,
  getSchoolTeachers,
  toggleTeacherStatus,
  getTeacherDetails,
  deleteTeacher
} = require("../controllers/schoolTeacherCSVController");
const { protect, schoolAdmin } = require("../middlewares/authMiddleware");

// Configure multer for file upload
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

// Protected routes - require school admin authentication
router.use(protect, schoolAdmin);

// CSV Upload route
router.post("/bulk-upload/teachers", upload.single("csvFile"), bulkUploadTeachers);

// Teacher management routes
router.get("/teachers", getSchoolTeachers);
router.get("/teachers/:id", getTeacherDetails);
router.patch("/teachers/:id/toggle-status", toggleTeacherStatus);
router.delete("/teachers/:id", deleteTeacher);

module.exports = router;