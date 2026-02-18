const asyncHandler = require("express-async-handler");
const SchoolAdmin = require("../models/webapp-models/schoolAdminModel");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");

// utility to send email (you can switch to your sendEmail util if you prefer)
const sendOtpEmail = async (to, otp) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "your-email@gmail.com", // TODO: replace with env vars
      pass: "your-email-password",
    },
  });

  const mailOptions = {
    from: "no-reply@assessaai.com",
    to,
    subject: "AssessaAI - School Admin Password Reset OTP",
    html: `<p>Your OTP for resetting school admin password is:</p>
           <h2>${otp}</h2>
           <p>This OTP is valid for 10 minutes.</p>`,
  };

  await transporter.sendMail(mailOptions);
};

// POST /api/school-admin/forgot-password/send-otp
const sendOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const schoolAdmin = await SchoolAdmin.findOne({ email });
  if (!schoolAdmin) {
    return res.status(404).json({ message: "School admin not found" });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit

  schoolAdmin.resetOtpCode = otp;
  schoolAdmin.resetOtpExpire = Date.now() + 10 * 60 * 1000; // 10 minutes
  await schoolAdmin.save();

  await sendOtpEmail(email, otp);

  res.json({ message: "OTP sent successfully to school admin email" });
});

// POST /api/school-admin/forgot-password/verify-otp
const verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;

  const schoolAdmin = await SchoolAdmin.findOne({
    email,
    resetOtpCode: otp,
    resetOtpExpire: { $gt: Date.now() },
  });

  if (!schoolAdmin) {
    return res.status(400).json({ message: "Invalid or expired OTP" });
  }

  res.json({ message: "OTP verified successfully" });
});

// POST /api/school-admin/forgot-password/reset-password
const resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body;

  const schoolAdmin = await SchoolAdmin.findOne({
    email,
    resetOtpCode: otp,
    resetOtpExpire: { $gt: Date.now() },
  });

  if (!schoolAdmin) {
    return res.status(400).json({ message: "Invalid or expired OTP" });
  }

  const salt = await bcrypt.genSalt(10);
  schoolAdmin.password = await bcrypt.hash(newPassword, salt);
  schoolAdmin.resetOtpCode = undefined;
  schoolAdmin.resetOtpExpire = undefined;

  await schoolAdmin.save();

  res.json({ message: "School admin password reset successful" });
});

module.exports = {
  sendOtp,
  verifyOtp,
  resetPassword,
};
