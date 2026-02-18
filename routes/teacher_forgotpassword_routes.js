const express = require("express");
const {
  sendOTP,
  verifyOTP,
  resetPassword,
} = require("../controllers/teacher_forgotpassword_controller");

const router = express.Router();

// Route to send OTP
router.post("/send-otp", sendOTP);

// Route to verify OTP
router.post("/verify-otp", verifyOTP);

// Route to reset password
router.post("/reset-password", resetPassword);

module.exports = router;
