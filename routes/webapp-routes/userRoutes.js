const express = require("express");
const router = express.Router();
const {
  registerUser,
  authUser,
  updateUserProfile,
  requestPasswordReset,
  resetPassword,
  testPasswordHashing, // Import the test route 
  getUserProfile // <-- Add this line
} = require("../../controllers/userController");
const { protect } = require("../../middlewares/authMiddleware");

router.post("/register", registerUser); // User registration route
router.post("/login", authUser); // User login route
// router.post("/profile", protect, updateUserProfile); // Protected route to update user profile
router.put("/profile", protect, updateUserProfile); // <-- This line

// Forgot password routes
router.post("/forgot-password", requestPasswordReset); // Request password reset (sends email)
router.post("/reset-password", resetPassword); // Reset password using token
// Test Password Hashing Route
router.post("/test-hashing", testPasswordHashing); // Add this line
router.get("/profile", protect, getUserProfile);


module.exports = router;
