const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const Userwebapp = require("../models/webapp-models/userModel");
const Teacher = require("../models/webapp-models/teacherModel");
const Admin = require("../models/webapp-models/adminModel");
const SchoolAdmin = require("../models/webapp-models/schoolAdminModel");

const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];
      
      console.log("🔑 Token received");
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      console.log("🔑 Decoded JWT ID:", decoded._id);

      // ✅ DEBUG: Check ALL collections for this user ID
      let user = null;
      let userRole = null;

      // 1. Check SchoolAdmin FIRST (since this is school admin route)
      user = await SchoolAdmin.findById(decoded._id).select("-password");
      if (user) {
        user.role = "schoolAdmin";
        userRole = "schoolAdmin";
        console.log("✅ Found: School Admin user");
      }

      // 2. Check Admin
      if (!user) {
        user = await Admin.findById(decoded._id).select("-password");
        if (user) {
          user.role = "admin";
          userRole = "admin";
          console.log("✅ Found: Platform Admin user");
        }
      }

      // 3. Check Teacher
      if (!user) {
        user = await Teacher.findById(decoded._id).select("-password");
        if (user) {
          user.role = "teacher";
          userRole = "teacher";
          console.log("✅ Found: Teacher user");
        }
      }

      // 4. Check Student (Userwebapp)
      if (!user) {
        user = await Userwebapp.findById(decoded._id).select("-password");
        if (user) {
          user.role = user.role || "student";
          userRole = user.role;
          console.log("✅ Found: Student user");
        }
      }

      if (!user) {
        console.error("❌ No user found with ID:", decoded._id);
        res.status(401).json({ message: "User not found" });
        return;
      }

      // ✅ IMPORTANT: Set req.user and log it
      req.user = user;
      req.user.role = userRole; // Ensure role is set
      
      console.log("👤 req.user set with:", {
        _id: req.user._id.toString(),
        role: req.user.role,
        email: req.user.email || req.user.schoolName || 'N/A',
        name: req.user.name || req.user.schoolName || 'N/A'
      });

      next();
    } catch (error) {
      console.error("❌ Auth Error:", error.message);
      console.error("❌ Token verification failed");
      res.status(401).json({ message: "Not authorized, token failed" });
      return;
    }
  } else {
    console.error("❌ No authorization header or Bearer token");
    res.status(401).json({ message: "Not authorized, no token" });
    return;
  }
});

// Admin middleware - for platform admin only (NO CHANGE)
const admin = (req, res, next) => {
  console.log("🔒 Admin middleware check - User role:", req.user?.role);
  if (req.user && req.user.role === "admin") {
    console.log("✅ Admin authorized");
    next();
  } else {
    console.log("❌ Not authorized as admin");
    res.status(403).json({ message: "Not authorized as admin" });
  }
};

// ✅ UPDATED: School Admin middleware - allow platform admin to access school admin routes
// This is safe because platform admin has higher privileges
const schoolAdmin = (req, res, next) => {
  console.log("🔒 SchoolAdmin middleware check - User role:", req.user?.role);
  
  // ✅ Allow both schoolAdmin AND platform admin (admin has higher privileges)
  if (req.user && (req.user.role === "schoolAdmin" || req.user.role === "admin")) {
    console.log("✅ School Admin or Platform Admin authorized");
    next();
  } else {
    console.log("❌ Not authorized as school admin");
    console.log("❌ User data:", {
      _id: req.user?._id,
      role: req.user?.role,
      name: req.user?.name || req.user?.schoolName
    });
    res.status(403).json({ message: "Not authorized as school admin" });
  }
};

// Teacher middleware - NO CHANGE
const teacher = (req, res, next) => {
  console.log("🔒 Teacher middleware check - User role:", req.user?.role);
  if (req.user && req.user.role === "teacher") {
    console.log("✅ Teacher authorized");
    next();
  } else {
    console.log("❌ Not authorized as teacher");
    res.status(403).json({ message: "Not authorized as teacher" });
  }
};

// Student middleware - NO CHANGE
const student = (req, res, next) => {
  console.log("🔒 Student middleware check - User role:", req.user?.role);
  if (req.user && (req.user.role === "student" || req.user.role === "user")) {
    console.log("✅ Student authorized");
    next();
  } else {
    console.log("❌ Not authorized as student");
    res.status(403).json({ message: "Not authorized as student" });
  }
};

module.exports = { protect, admin, schoolAdmin, teacher, student };