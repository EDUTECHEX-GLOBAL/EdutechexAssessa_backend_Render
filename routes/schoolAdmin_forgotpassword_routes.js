const express = require("express");
const router = express.Router();

const {
  sendOtp,
  verifyOtp,
  resetPassword,
} = require("../controllers/schoolAdminForgotPasswordController");

// POST /api/school-admin/forgot-password/send-otp
router.post("/send-otp", sendOtp);

// POST /api/school-admin/forgot-password/verify-otp
router.post("/verify-otp", verifyOtp);

// POST /api/school-admin/forgot-password/reset-password
router.post("/reset-password", resetPassword);

module.exports = router;
