const express = require("express");
const router = express.Router();
const multer = require("multer");
const {
  bulkUploadStudents,
  getSchoolStudents,
  toggleStudentStatus,
  getStudentDetails,
  deleteStudent
} = require("../controllers/schoolStudentCSVController");
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
router.post("/bulk-upload/students", upload.single("csvFile"), bulkUploadStudents);

// Student management routes
router.get("/students", getSchoolStudents);
router.get("/students/:id", getStudentDetails);
router.patch("/students/:id/toggle-status", toggleStudentStatus);
router.delete("/students/:id", deleteStudent);

module.exports = router;