const asyncHandler = require("express-async-handler");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const Userwebapp = require("../models/webapp-models/userModel");
const Admin = require("../models/webapp-models/adminModel");
const SubscriptionPlan = require("../models/webapp-models/subscriptionPlanModel");
const generateToken = require("../utils/generateToken");
const { getSignedUrl } = require("../config/s3Upload");
const sendEmail = require("../utils/mailer");
const { createAdminNotification } = require("./adminNotificationController");

// Register User
const registerUser = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;
  let { pic } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: "Please fill all required fields." });
  }

  const userExists = await Userwebapp.findOne({ email });
  if (userExists) {
    return res.status(400).json({ message: "User already exists." });
  }

  if (!pic) {
    pic = "https://icon-library.com/images/anonymous-avatar-icon/anonymous-avatar-icon-25.jpg";
  }

  // FIXED: Create user first, then assign free plan asynchronously
  const user = await Userwebapp.create({
    name,
    email,
    password,
    role,
    pic,
    isAdminApproved: false,
    status: "pending",
    // Don't assign subscription here - let it be assigned by the method
  });

  if (user) {
    // ✅ Auto-assign free plan to new user (async - don't wait for it)
    setTimeout(async () => {
      try {
        await user.assignFreePlan();
        console.log(`✅ Free plan assigned to new user: ${user.email}`);
      } catch (error) {
        console.error("Error assigning free plan to new user:", error);
      }
    }, 1000);

    // ✅ ADD NOTIFICATION CREATION HERE
    try {
      const admin = await Admin.findOne();
      
      if (admin) {
        await createAdminNotification(admin._id, {
          type: "login_request",
          title: "New Student Registration",
          message: `${user.name} (${user.email}) has requested access as a student`,
          data: {
            userId: user._id,
            role: "student",
          },
          priority: "high",
        });
      }
    } catch (error) {
      console.error("Notification error:", error);
    }

    // Notify admin about new student signup
    await sendEmail.sendAdminStudentSignupEmail(user.name, user.email);
    
    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isAdmin: user.isAdmin,
      pic: user.pic,
      token: generateToken(user._id),
    });
  } else {
    res.status(400).json({ message: "Error Occurred" });
  }
});

// Login (Authenticate User)
const authUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await Userwebapp.findOne({ email });

  if (user && (await user.matchPassword(password))) {
    if (user.status === "rejected") {
      return res.status(403).json({ message: "Your registration has been rejected." });
    }
    if (user.status === "pending" || !user.isAdminApproved) {
      return res.status(403).json({ message: "Your account is pending admin approval." });
    }
    if (user.status === "inactive") {
      return res.status(403).json({ message: "Your account has been deactivated by admin." });
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      role: user.role,
      pic: user.pic,
      token: generateToken(user._id),
    });
  } else {
    res.status(400).json({ message: "Invalid Email or Password!" });
  }
});

// Update User Profile
const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await Userwebapp.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  // Update all fields if present in req.body
  user.name = req.body.name !== undefined ? req.body.name : user.name;
  user.email = req.body.email !== undefined ? req.body.email : user.email;
  user.class = req.body.class !== undefined ? req.body.class : user.class;
  user.mobile = req.body.mobile !== undefined ? req.body.mobile : user.mobile;
  user.bio = req.body.bio !== undefined ? req.body.bio : user.bio;
  user.city = req.body.city !== undefined ? req.body.city : user.city;
  user.country = req.body.country !== undefined ? req.body.country : user.country;
  user.pic = req.body.pic !== undefined ? req.body.pic : user.pic;

  if (req.body.password) {
    user.password = await bcrypt.hash(req.body.password, 10);
  }

  const updatedUser = await user.save();

  res.json({
    _id: updatedUser._id,
    name: updatedUser.name,
    email: updatedUser.email,
    class: updatedUser.class,
    mobile: updatedUser.mobile,
    bio: updatedUser.bio,
    city: updatedUser.city,
    country: updatedUser.country,
    pic: updatedUser.pic,
    role: updatedUser.role,
    isAdmin: updatedUser.isAdmin,
  });
});

// Forgot Password - Request Reset
const requestPasswordReset = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await Userwebapp.findOne({ email });
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  user.resetPasswordToken = crypto.createHash("sha256").update(resetToken).digest("hex");
  user.resetPasswordExpire = Date.now() + 3600000; // 1 hour

  await user.save();

  const resetUrl = `http://localhost:3000/reset-password/${resetToken}`; // Change to your frontend URL

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "your-email@gmail.com",
      pass: "your-email-password",
    },
  });

  const mailOptions = {
    from: "no-reply@assessaai.com",
    to: user.email,
    subject: "Password Reset Request",
    html: `<p>You requested a password reset. Click the link below to reset your password:</p>
           <a href="${resetUrl}">${resetUrl}</a>`,
  };

  await transporter.sendMail(mailOptions);

  res.json({ message: "Password reset link sent to your email" });
});

// Forgot Password - Reset Password
const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const user = await Userwebapp.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpire: { $gt: Date.now() },
  });

  if (!user) {
    return res.status(400).json({ message: "Invalid or expired token" });
  }

  user.password = await bcrypt.hash(newPassword, 10);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;

  await user.save();

  res.json({ message: "Password reset successful. You can now log in." });
});

// Test Password Hashing
const testPasswordHashing = asyncHandler(async (req, res) => {
  const { plainPassword } = req.body;
  const hashedPassword = "$2b$10$R0MyMGKvcj50R93vKkuVGuhCFmRJQnK2VeJYj6efR0M/hjIUeuyRy"; // Replace with actual hash from DB

  try {
    const match = await bcrypt.compare(plainPassword, hashedPassword);
    res.json({ match });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get User Profile
const getUserProfile = asyncHandler(async (req, res) => {
  const user = await Userwebapp.findById(req.user._id).select("-password -resetPasswordToken -resetPasswordExpire");
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }
  let picUrl = user.pic;
  if (picUrl && !picUrl.startsWith("http")) {
    picUrl = getSignedUrl(picUrl);
  }
  res.json({
    _id: user._id,
    name: user.name,
    email: user.email,
    class: user.class || "",
    mobile: user.mobile || "",
    bio: user.bio || "",
    city: user.city || "",
    country: user.country || "",
    pic: picUrl,
    role: user.role,
    isAdmin: user.isAdmin,
    status: user.status,
    isAdminApproved: user.isAdminApproved
  });
});

module.exports = { 
  registerUser, 
  authUser, 
  updateUserProfile, 
  requestPasswordReset, 
  resetPassword,
  testPasswordHashing,
  getUserProfile
};