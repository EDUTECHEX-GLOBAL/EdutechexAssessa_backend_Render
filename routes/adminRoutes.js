const express = require("express");
const {
  authAdmin,
  getApprovalRequests,
  approveRequest,
  rejectRequest,
  getApprovalCounts,
  getDashboardStats,
  getAllTeachers,
  getAllStudents,
  getAllSchoolAdmins, // ADD THIS IMPORT
  deleteAccount,
  toggleAccess,
} = require("../controllers/adminController");
const { protect, admin } = require("../middlewares/authMiddleware");

const router = express.Router();

// Admin login
router.post("/login", authAdmin);

// All routes below require admin authentication
router.use(protect);
router.use(admin); // All routes below require admin role

// Approval management
router.get("/approvals", getApprovalRequests);
router.patch("/approvals/:id/approve", approveRequest);
router.patch("/approvals/:id/reject", rejectRequest);
router.get("/approvals/counts", getApprovalCounts);

// Dashboard stats
router.get("/dashboard/stats", getDashboardStats);

// Admin controlling (teachers, students, and school admins)
router.get("/teachers", getAllTeachers);
router.get("/students", getAllStudents);
router.get("/school-admins", getAllSchoolAdmins); // ADD THIS ROUTE
router.delete("/:id", deleteAccount);         // body: { role: "teacher" | "student" | "schoolAdmin" }
router.patch("/:id/toggle", toggleAccess);    // body: { role, action: "grant" | "revoke" }

module.exports = router;