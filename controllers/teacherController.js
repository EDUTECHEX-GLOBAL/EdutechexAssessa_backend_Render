const asyncHandler = require("express-async-handler");
const bcrypt = require("bcryptjs");
const Teacher = require("../models/webapp-models/teacherModel");
const Admin = require("../models/webapp-models/adminModel");
const generateToken = require("../utils/generateToken");
const { getSignedUrl } = require("../config/s3Upload");
const sendEmail = require("../utils/mailer");
const { createAdminNotification } = require("./adminNotificationController");

// ============================
// REGISTER
// ============================
const registerTeacher = asyncHandler(async (req, res) => {
  const { name, email, password, pic } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Please fill all required fields." });
  }

  const teacherExists = await Teacher.findOne({ email });
  if (teacherExists) {
    return res.status(400).json({ message: "Teacher already exists." });
  }

  const teacher = await Teacher.create({
    name,
    email,
    password,
    pic, // S3 key (if uploaded before register) OR default
    role: "teacher",
    status: "pending",
  });

  if (teacher) {
    
    try {
      const admin = await Admin.findOne(); // ✅ FIXED: Removed hardcoded email
      
      if (admin) {
        const notification = await createAdminNotification(admin._id, {
          type: "login_request",
          title: "New Teacher Registration",
          message: `${teacher.name} (${teacher.email}) has requested access as a teacher`,
          data: {
            userId: teacher._id,
            role: "teacher",
          },
          priority: "high",
        });
      } else {
        console.log('❌ No admin found for teacher notification');
      }
    } catch (error) {
      console.error('❌ Teacher notification error:', error);
    }
    // ✅ END OF DEBUG CODE

    // notify admin (existing email)
    await sendEmail.sendAdminTeacherSignupEmail(teacher.name, teacher.email);

    res.status(201).json({
      message: "Registered successfully. Awaiting admin approval.",
    });
  } else {
    res.status(400).json({ message: "Error occurred during registration." });
  }
});

// ============================
// LOGIN - NO CHANGES NEEDED
// ============================
const authTeacher = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const teacher = await Teacher.findOne({ email });

  if (!teacher) {
    return res.status(400).json({ message: "Invalid Email or Password!" });
  }

  if (teacher.status === "pending") {
    return res.status(403).json({ message: "Your account is awaiting admin approval." });
  }

  if (teacher.status === "rejected") {
    return res.status(403).json({ message: "Your registration has been rejected." });
  }

  if (teacher.status === "inactive") {
    return res.status(403).json({ message: "Your account has been revoked by the admin." });
  }

  if (await teacher.matchPassword(password)) {
    // ✅ FIX: return signed URL if stored as S3 key
    let signedPicUrl = null;
    if (teacher.pic && !teacher.pic.startsWith("http")) {
      signedPicUrl = getSignedUrl(teacher.pic);
    } else {
      signedPicUrl = teacher.pic;
    }

    res.json({
      _id: teacher._id,
      name: teacher.name,
      email: teacher.email,
      pic: signedPicUrl, // <-- always usable URL
      role: teacher.role,
      status: teacher.status,
      token: generateToken(teacher._id),
    });
  } else {
    res.status(400).json({ message: "Invalid Email or Password!" });
  }
});

// ============================
// GET PROFILE (with signed pic URL) - NO CHANGES
// ============================
const getTeacherProfile = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findById(req.user._id).select("-password");

  if (!teacher) {
    return res.status(404).json({ message: "Teacher not found" });
  }

  let signedPicUrl = null;
  if (teacher.pic && !teacher.pic.startsWith("http")) {
    // it's an S3 key, generate signed URL
    signedPicUrl = getSignedUrl(teacher.pic);
  } else {
    signedPicUrl = teacher.pic; // already a URL (default or external)
  }

  res.json({
    _id: teacher._id,
    name: teacher.name,
    email: teacher.email,
    role: teacher.role,
    status: teacher.status,
    pic: signedPicUrl,
    className: teacher.className || "",
    selectedSubjects: teacher.selectedSubjects || [],
    createdAt: teacher.createdAt,
    updatedAt: teacher.updatedAt,
  });
});

// ============================
// UPDATE PROFILE - NO CHANGES
// ============================
const updateTeacherProfile = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findById(req.user._id);

  if (!teacher) {
    return res.status(404).json({ message: "Teacher Not Found!" });
  }

  teacher.name = req.body.name || teacher.name;
  teacher.email = req.body.email || teacher.email;
  teacher.pic = req.body.pic || teacher.pic;
  teacher.className = req.body.className || teacher.className;
  teacher.selectedSubjects = req.body.selectedSubjects || teacher.selectedSubjects;

  if (req.body.password) {
    teacher.password = await bcrypt.hash(req.body.password, 10);
  }

  const updatedTeacher = await teacher.save();

  let signedPicUrl = null;
  if (updatedTeacher.pic && !updatedTeacher.pic.startsWith("http")) {
    signedPicUrl = getSignedUrl(updatedTeacher.pic);
  } else {
    signedPicUrl = updatedTeacher.pic;
  }

  res.json({
    _id: updatedTeacher._id,
    name: updatedTeacher.name,
    email: updatedTeacher.email,
    role: updatedTeacher.role,
    status: updatedTeacher.status,
    pic: signedPicUrl,
    className: updatedTeacher.className || "",
    selectedSubjects: updatedTeacher.selectedSubjects || [],
    token: generateToken(updatedTeacher._id),
  });
});

module.exports = {
  registerTeacher,
  authTeacher,
  getTeacherProfile,
  updateTeacherProfile,
};