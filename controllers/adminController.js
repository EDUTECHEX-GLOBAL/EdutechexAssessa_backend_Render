const asyncHandler = require("express-async-handler");
const Admin = require("../models/webapp-models/adminModel");
const User = require("../models/webapp-models/userModel");
const Teacher = require("../models/webapp-models/teacherModel");
const SchoolAdmin = require("../models/webapp-models/schoolAdminModel"); // ADD THIS IMPORT
const { createAdminNotification } = require("./adminNotificationController");
const generateToken = require("../utils/generateToken");
const sendEmail = require("../utils/mailer");

// Admin login
const authAdmin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const admin = await Admin.findOne({ email });

  if (!admin || !(await admin.matchPassword(password))) {
    return res.status(400).json({ message: "Invalid Email or Password!" });
  }

  res.json({
    _id: admin._id,
    email: admin.email,
    token: generateToken(admin._id),
  });
});

// Get approval requests (students + teachers + schoolAdmins)
const getApprovalRequests = asyncHandler(async (req, res) => {
  const status = req.query.status;
  let filter = {};
  if (["pending", "approved", "rejected"].includes(status)) {
    filter.status = status;
  }

  const students = await User.find(filter).lean();
  const teachers = await Teacher.find(filter).lean();
  const schoolAdmins = await SchoolAdmin.find(filter).lean(); // ADD THIS

  const merged = [
    ...students.map((user) => ({ ...user, role: "student" })),
    ...teachers.map((teacher) => ({ ...teacher, role: "teacher" })),
    ...schoolAdmins.map((admin) => ({ ...admin, role: "schoolAdmin" })), // ADD THIS
  ];

  // Sort by creation date (newest first)
  merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(merged);
});

// Approve user, teacher, or schoolAdmin
const approveRequest = asyncHandler(async (req, res) => {
  const { role } = req.body;

  let account;
  if (role === "teacher") {
    account = await Teacher.findById(req.params.id);
  } else if (role === "schoolAdmin") {
    account = await SchoolAdmin.findById(req.params.id);
  } else {
    account = await User.findById(req.params.id);
  }

  if (!account) return res.status(404).json({ message: `${role} not found` });

  account.status = "approved";
  account.isAdminApproved = true;
  await account.save();

  // Create notification for approval
  await createAdminNotification(req.user._id, {
    type: "approval_approved",
    title: `${role.charAt(0).toUpperCase() + role.slice(1)} Approved`,
    message: `${account.name || account.schoolName} (${account.email}) has been approved`,
    data: {
      userId: account._id,
      role: role,
    },
    priority: "medium",
  });

  await sendEmail.sendApprovalEmail(account.email, account.name || account.schoolName, role);

  res.json({ message: `${role} approved successfully` });
});

// Reject user, teacher, or schoolAdmin
const rejectRequest = asyncHandler(async (req, res) => {
  const { reason, role } = req.body;

  let account;
  if (role === "teacher") {
    account = await Teacher.findById(req.params.id);
  } else if (role === "schoolAdmin") {
    account = await SchoolAdmin.findById(req.params.id);
  } else {
    account = await User.findById(req.params.id);
  }

  if (!account) return res.status(404).json({ message: `${role} not found` });

  account.status = "rejected";
  account.rejectionReason = reason;
  account.isAdminApproved = false;
  await account.save();

  // Create notification for rejection
  await createAdminNotification(req.admin._id, {
    type: "approval_rejected",
    title: `${role.charAt(0).toUpperCase() + role.slice(1)} Rejected`,
    message: `${account.name || account.schoolName} (${account.email}) has been rejected. Reason: ${reason}`,
    data: {
      userId: account._id,
      role: role,
    },
    priority: "medium",
  });

  await sendEmail.sendRejectionEmail(account.email, account.name || account.schoolName, reason);

  res.json({ message: `${role} rejected successfully` });
});

// Get pending approval counts for all roles
const getApprovalCounts = asyncHandler(async (req, res) => {
  const studentCount = await User.countDocuments({ status: 'pending' });
  const teacherCount = await Teacher.countDocuments({ status: 'pending' });
  const schoolAdminCount = await SchoolAdmin.countDocuments({ status: 'pending' }); // ADD THIS

  res.json({
    total: studentCount + teacherCount + schoolAdminCount,
    students: studentCount,
    teachers: teacherCount,
    schoolAdmins: schoolAdminCount, // ADD THIS
  });
});

// Get overall dashboard stats (teachers + users + schoolAdmins)
const getDashboardStats = asyncHandler(async (req, res) => {
  try {
    // Teachers
    const totalTeachers = await Teacher.countDocuments();
    const approvedTeachers = await Teacher.countDocuments({ status: "approved" });
    const pendingTeachers = await Teacher.countDocuments({ status: "pending" });
    const rejectedTeachers = await Teacher.countDocuments({ status: "rejected" });
    const inactiveTeachers = pendingTeachers + rejectedTeachers;

    // Users (students)
    const totalUsers = await User.countDocuments();
    const approvedUsers = await User.countDocuments({ status: "approved" });
    const pendingUsers = await User.countDocuments({ status: "pending" });

    // School Admins
    const totalSchoolAdmins = await SchoolAdmin.countDocuments(); // ADD THIS
    const approvedSchoolAdmins = await SchoolAdmin.countDocuments({ status: "approved" }); // ADD THIS
    const pendingSchoolAdmins = await SchoolAdmin.countDocuments({ status: "pending" }); // ADD THIS

    res.json({
      teachers: {
        total: totalTeachers,
        active: approvedTeachers,
        inactive: inactiveTeachers,
      },
      users: {
        total: totalUsers,
        active: approvedUsers,
        pending: pendingUsers,
      },
      schoolAdmins: { // ADD THIS SECTION
        total: totalSchoolAdmins,
        active: approvedSchoolAdmins,
        pending: pendingSchoolAdmins,
      }
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    res.status(500).json({ message: "Failed to fetch stats" });
  }
});

// Get all teachers
const getAllTeachers = asyncHandler(async (req, res) => {
  const teachers = await Teacher.find().lean();
  res.json(teachers);
});

// Get all students
const getAllStudents = asyncHandler(async (req, res) => {
  const students = await User.find().lean();
  res.json(students);
});

// Get all school admins
const getAllSchoolAdmins = asyncHandler(async (req, res) => {
  const schoolAdmins = await SchoolAdmin.find().lean();
  res.json(schoolAdmins);
});

// Delete teacher, student, or schoolAdmin
const deleteAccount = asyncHandler(async (req, res) => {
  const { role } = req.body;

  if (role === "teacher") {
    await Teacher.findByIdAndDelete(req.params.id);
    return res.json({ message: "Teacher deleted successfully" });
  } else if (role === "schoolAdmin") {
    await SchoolAdmin.findByIdAndDelete(req.params.id);
    return res.json({ message: "School Admin deleted successfully" });
  } else {
    await User.findByIdAndDelete(req.params.id);
    return res.json({ message: "Student deleted successfully" });
  }
});

// Toggle access (grant/revoke after approval)
const toggleAccess = asyncHandler(async (req, res) => {
  const { role, action } = req.body;

  let account;
  if (role === "teacher") {
    account = await Teacher.findById(req.params.id);
  } else if (role === "schoolAdmin") {
    account = await SchoolAdmin.findById(req.params.id);
  } else {
    account = await User.findById(req.params.id);
  }

  if (!account) return res.status(404).json({ message: `${role} not found` });

  if (action === "grant") {
    account.status = "approved";
    account.isAdminApproved = true;
  } else if (action === "revoke") {
    account.status = "inactive";
    account.isAdminApproved = false;
  }

  await account.save();
  res.json({ message: `${role} access ${action}ed successfully` });
});

module.exports = {
  authAdmin,
  getApprovalRequests,
  approveRequest,
  rejectRequest,
  getApprovalCounts, 
  getDashboardStats,
  getAllTeachers,
  getAllStudents,
  getAllSchoolAdmins, // ADD THIS
  deleteAccount,
  toggleAccess,
};