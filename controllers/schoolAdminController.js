const asyncHandler = require("express-async-handler");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const SchoolAdmin = require("../models/webapp-models/schoolAdminModel");
const Admin = require("../models/webapp-models/adminModel");
const generateToken = require("../utils/generateToken");
const sendEmail = require("../utils/mailer");
const { createAdminNotification } = require("./adminNotificationController");

// Import assessment models
const AssessmentUpload = require("../models/webapp-models/assessmentuploadformModel");
const SatAssessment = require("../models/webapp-models/satAssessmentModel");

// POST /api/school-admin/register
const registerSchoolAdmin = asyncHandler(async (req, res) => {
  const { schoolName, city, email, password } = req.body;

  if (!schoolName || !city || !email || !password) {
    return res
      .status(400)
      .json({ message: "Please fill all required fields." });
  }

  const existing = await SchoolAdmin.findOne({ email });
  if (existing) {
    return res.status(400).json({ message: "School admin already exists." });
  }

  // Generate unique schoolId
  const generateSchoolId = () => {
    const namePart = schoolName
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, 4)
      .toUpperCase();
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    return `${namePart}${randomPart}`;
  };

  // Check if schoolId already exists
  let schoolId;
  let attempts = 0;
  let isUnique = false;
  
  while (!isUnique && attempts < 10) {
    schoolId = generateSchoolId();
    const existingWithSchoolId = await SchoolAdmin.findOne({ schoolId });
    if (!existingWithSchoolId) {
      isUnique = true;
    }
    attempts++;
  }

  if (!isUnique) {
    return res.status(500).json({ 
      message: "Could not generate unique school ID. Please try again." 
    });
  }

  const schoolAdmin = await SchoolAdmin.create({
    schoolName,
    city,
    email,
    password,
    schoolId,
    role: "schoolAdmin",
    status: "pending",
    isAdminApproved: false,
  });

  // Notify platform admin
  try {
    const platformAdmin = await Admin.findOne();

    if (platformAdmin) {
      await createAdminNotification(platformAdmin._id, {
        type: "school_admin_request",
        title: "New School Registration",
        message: `${schoolAdmin.schoolName} (${schoolAdmin.email}) from ${schoolAdmin.city} has requested a School Admin account.`,
        data: {
          schoolAdminId: schoolAdmin._id,
          schoolId: schoolAdmin.schoolId,
          email: schoolAdmin.email,
          schoolName: schoolAdmin.schoolName,
          city: schoolAdmin.city,
        },
        priority: "high",
      });
    }
  } catch (error) {
    console.error("Error creating school admin notification:", error);
  }

  return res.status(201).json({
    message:
      "School Admin registered successfully. Please wait for platform admin approval.",
    schoolAdmin: {
      _id: schoolAdmin._id,
      schoolId: schoolAdmin.schoolId,
      schoolName: schoolAdmin.schoolName,
      email: schoolAdmin.email,
      status: schoolAdmin.status,
    },
  });
});

// POST /api/school-admin/login
const authSchoolAdmin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const schoolAdmin = await SchoolAdmin.findOne({ email });

  if (!schoolAdmin) {
    return res.status(400).json({ message: "Invalid Email or Password!" });
  }

  if (schoolAdmin.status === "pending") {
    return res
      .status(403)
      .json({ message: "Your account is awaiting platform admin approval." });
  }

  if (schoolAdmin.status === "rejected") {
    return res
      .status(403)
      .json({ 
        message: `Your registration has been rejected. ${schoolAdmin.rejectionReason ? `Reason: ${schoolAdmin.rejectionReason}` : ''}` 
      });
  }

  if (schoolAdmin.status === "inactive") {
    return res
      .status(403)
      .json({ message: "Your account has been deactivated." });
  }

  if (await schoolAdmin.matchPassword(password)) {
    res.json({
      _id: schoolAdmin._id,
      schoolId: schoolAdmin.schoolId,
      schoolName: schoolAdmin.schoolName,
      city: schoolAdmin.city,
      email: schoolAdmin.email,
      role: schoolAdmin.role,
      status: schoolAdmin.status,
      isAdminApproved: schoolAdmin.isAdminApproved,
      token: generateToken(schoolAdmin._id),
    });
  } else {
    return res.status(400).json({ message: "Invalid Email or Password!" });
  }
});

// GET /api/school-admin/profile
const getSchoolAdminProfile = asyncHandler(async (req, res) => {
  const schoolAdmin = await SchoolAdmin.findById(req.user._id).select("-password -resetOtpCode -resetOtpExpire");
  
  if (!schoolAdmin) {
    return res.status(404).json({ message: "School Admin not found" });
  }

  res.json({
    success: true,
    profile: schoolAdmin.toProfileJSON ? schoolAdmin.toProfileJSON() : schoolAdmin
  });
});

// PUT /api/school-admin/profile
const updateSchoolAdminProfile = asyncHandler(async (req, res) => {
  const schoolAdmin = await SchoolAdmin.findById(req.user._id);
  
  if (!schoolAdmin) {
    return res.status(404).json({ message: "School Admin not found" });
  }

  // Fields that can be updated
  const updatableFields = {
    schoolName: req.body.schoolName,
    address: req.body.address,
    city: req.body.city,
    state: req.body.state,
    pincode: req.body.pincode,
    contactNumber: req.body.contactNumber,
    principalName: req.body.principalName,
    website: req.body.website,
    establishedYear: req.body.establishedYear,
    schoolType: req.body.schoolType,
    boardAffiliation: req.body.boardAffiliation,
    totalStudents: req.body.totalStudents,
    totalTeachers: req.body.totalTeachers,
    classes: req.body.classes,
    streams: req.body.streams,
  };

  // Remove undefined fields
  Object.keys(updatableFields).forEach(key => {
    if (updatableFields[key] !== undefined) {
      schoolAdmin[key] = updatableFields[key];
    }
  });

  // Update lastUpdated timestamp
  schoolAdmin.lastUpdated = Date.now();

  const updatedSchoolAdmin = await schoolAdmin.save();

  // Prepare response
  const responseData = {
    _id: updatedSchoolAdmin._id,
    schoolId: updatedSchoolAdmin.schoolId,
    schoolName: updatedSchoolAdmin.schoolName,
    schoolCode: updatedSchoolAdmin.schoolCode,
    address: updatedSchoolAdmin.address,
    city: updatedSchoolAdmin.city,
    state: updatedSchoolAdmin.state,
    pincode: updatedSchoolAdmin.pincode,
    email: updatedSchoolAdmin.email,
    contactNumber: updatedSchoolAdmin.contactNumber,
    principalName: updatedSchoolAdmin.principalName,
    website: updatedSchoolAdmin.website,
    establishedYear: updatedSchoolAdmin.establishedYear,
    schoolType: updatedSchoolAdmin.schoolType,
    boardAffiliation: updatedSchoolAdmin.boardAffiliation,
    totalStudents: updatedSchoolAdmin.totalStudents,
    totalTeachers: updatedSchoolAdmin.totalTeachers,
    activeStudents: updatedSchoolAdmin.activeStudents,
    activeTeachers: updatedSchoolAdmin.activeTeachers,
    classes: updatedSchoolAdmin.classes,
    streams: updatedSchoolAdmin.streams,
    subscriptionPlan: updatedSchoolAdmin.subscriptionPlan,
    subscriptionExpiry: updatedSchoolAdmin.subscriptionExpiry,
    status: updatedSchoolAdmin.status,
    verificationStatus: updatedSchoolAdmin.verificationStatus,
    registrationDate: updatedSchoolAdmin.registrationDate,
    lastUpdated: updatedSchoolAdmin.lastUpdated,
  };

  res.json({
    success: true,
    message: "Profile updated successfully",
    updatedProfile: responseData,
  });
});

// PUT /api/school-admin/profile/password
const updateSchoolAdminPassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "Please provide both current and new password" });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters long" });
  }

  const schoolAdmin = await SchoolAdmin.findById(req.user._id);
  
  if (!schoolAdmin) {
    return res.status(404).json({ message: "School Admin not found" });
  }

  // Verify current password
  const isMatch = await schoolAdmin.matchPassword(currentPassword);
  if (!isMatch) {
    return res.status(400).json({ message: "Current password is incorrect" });
  }

  // Update password
  schoolAdmin.password = newPassword;
  await schoolAdmin.save();

  res.json({
    success: true,
    message: "Password updated successfully",
  });
});

// GET /api/school-admin/dashboard/stats
// GET /api/school-admin/dashboard/stats
const getDashboardStats = asyncHandler(async (req, res) => {
  try {
    const schoolAdminId = req.user._id;
    
    // Get school admin with schoolId
    const schoolAdmin = await SchoolAdmin.findById(schoolAdminId).select("schoolName schoolId");
    
    if (!schoolAdmin) {
      return res.status(404).json({ 
        success: false, 
        message: "School Admin not found" 
      });
    }

    // The schoolAdmin._id is the ObjectId that should be used as schoolId in other models
    const schoolObjectId = schoolAdmin._id; // This is the ObjectId that references SchoolAdmin

    // Import models
    const SchoolStudentCSV = require("../models/webapp-models/schoolStudentCSVModel");
    const SchoolTeacherCSV = require("../models/webapp-models/schoolTeacherCSVModel");
    const AssessmentSubmission = require("../models/webapp-models/assessmentSubmissionModel");
    const SatSubmission = require("../models/webapp-models/satSubmissionModel");
    const Teacher = require("../models/webapp-models/teacherModel");
    const Userwebapp = require("../models/webapp-models/userModel");

    console.log(`🔍 Fetching stats for school: ${schoolAdmin.schoolName}, ObjectId: ${schoolObjectId}`);

    // Run all queries in parallel using schoolObjectId
    const [
      // Count students from CSV for THIS SCHOOL
      studentStats,
      // Count teachers from CSV for THIS SCHOOL
      teacherStats,
      // Count assessments created in THIS SCHOOL (using schoolId field)
      standardAssessments,
      satAssessments,
      // Count attempts made in THIS SCHOOL (using schoolId field)
      standardSubmissions,
      satSubmissions,
      // Get teachers in THIS SCHOOL
      schoolTeachers,
      // Get students in THIS SCHOOL from Userwebapp
      webappStudentsCount
    ] = await Promise.all([
      // Student counts from CSV for this school admin
      SchoolStudentCSV.aggregate([
        { $match: { schoolAdmin: schoolAdminId } },
        { 
          $group: {
            _id: "$status",
            count: { $sum: 1 }
          }
        }
      ]),
      
      // Teacher counts from CSV for this school admin
      SchoolTeacherCSV.aggregate([
        { $match: { schoolAdmin: schoolAdminId } },
        { 
          $group: {
            _id: "$status",
            count: { $sum: 1 }
          }
        }
      ]),
      
      // Count standard assessments created for THIS SCHOOL (using schoolId field)
      AssessmentUpload.countDocuments({ 
        schoolId: schoolObjectId, // Use the ObjectId, not string schoolId
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      }),
      
      // Count SAT assessments created for THIS SCHOOL (using schoolId field)
      SatAssessment.countDocuments({ 
        schoolId: schoolObjectId, // Use the ObjectId, not string schoolId
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      }),
      
      // Count standard submissions made in THIS SCHOOL (using schoolId field)
      AssessmentSubmission.countDocuments({ 
        schoolId: schoolObjectId, // Use the ObjectId, not string schoolId
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      }),
      
      // Count SAT submissions made in THIS SCHOOL (using schoolId field)
      SatSubmission.countDocuments({ 
        schoolId: schoolObjectId, // Use the ObjectId, not string schoolId
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      }),
      
      // Get all teachers in this school
      Teacher.find({ 
        schoolAdmin: schoolAdminId // This might be the field name, check Teacher model
      }).select("_id status"),
      
      // Count students in this school from Userwebapp
      Userwebapp.countDocuments({ 
        schoolId: schoolAdmin.schoolId, // This is the string schoolId like "DELI1234"
        role: "student"
      })
    ]);

    console.log(`📊 Results for school ${schoolObjectId}:`);
    console.log(`   Standard Assessments: ${standardAssessments}`);
    console.log(`   SAT Assessments: ${satAssessments}`);
    console.log(`   Standard Submissions: ${standardSubmissions}`);
    console.log(`   SAT Submissions: ${satSubmissions}`);
    console.log(`   Webapp Students: ${webappStudentsCount}`);
    console.log(`   Teachers in school: ${schoolTeachers.length}`);

    // Helper function to transform stats
    const transformStats = (statsArray) => {
      const result = {
        pending: 0,
        active: 0,
        inactive: 0,
        rejected: 0,
        total: 0
      };
      
      statsArray.forEach(stat => {
        if (stat._id in result) {
          result[stat._id] = stat.count;
          result.total += stat.count;
        }
      });
      
      return result;
    };

    const studentCSVStats = transformStats(studentStats);
    const teacherCSVStats = transformStats(teacherStats);

    // Calculate active teachers from Teacher model
    const activeTeachers = schoolTeachers.filter(t => t.status === "approved").length;
    const inactiveTeachers = schoolTeachers.length - activeTeachers;

    // Get active students count (you may need to adjust this based on your logic)
    const activeStudents = studentCSVStats.active || 0;
    const inactiveStudents = studentCSVStats.inactive || 0;
    
    // Assessment counts for this school
    const totalStandardAssessments = standardAssessments || 0;
    const totalSATAssessments = satAssessments || 0;
    const totalGeneratedAssessments = totalStandardAssessments + totalSATAssessments;
    
    // Student attempts counts for this school
    const standardAttempts = standardSubmissions || 0;
    const satAttempts = satSubmissions || 0;
    const totalStudentAttempts = standardAttempts + satAttempts;

    // Get recent data (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const [recentStandard, recentSAT, recentStandardAttempts, recentSATAttempts] = await Promise.all([
      AssessmentUpload.countDocuments({ 
        schoolId: schoolObjectId,
        createdAt: { $gte: sevenDaysAgo }
      }),
      SatAssessment.countDocuments({ 
        schoolId: schoolObjectId,
        createdAt: { $gte: sevenDaysAgo }
      }),
      AssessmentSubmission.countDocuments({ 
        schoolId: schoolObjectId,
        createdAt: { $gte: sevenDaysAgo }
      }),
      SatSubmission.countDocuments({ 
        schoolId: schoolObjectId,
        createdAt: { $gte: sevenDaysAgo }
      })
    ]);

    const recentUploads = recentStandard + recentSAT;
    const recentAttempts = recentStandardAttempts + recentSATAttempts;

    // Calculate engagement rate
    const totalCSVUsers = studentCSVStats.total + teacherCSVStats.total;
    const activeCSVUsers = activeStudents + activeTeachers;
    const engagementRate = totalCSVUsers > 0 
      ? Math.round((activeCSVUsers / totalCSVUsers) * 100) 
      : 0;

    // Calculate average score for this school
    let averageScore = 0;
    
    if (totalStudentAttempts > 0) {
      const [standardScores, satScores] = await Promise.all([
        AssessmentSubmission.aggregate([
          { 
            $match: { 
              schoolId: schoolObjectId,
              createdAt: { $gte: sevenDaysAgo },
              percentage: { $exists: true, $ne: null }
            }
          },
          { $group: { _id: null, avgScore: { $avg: "$percentage" } } }
        ]),
        SatSubmission.aggregate([
          { 
            $match: { 
              schoolId: schoolObjectId,
              createdAt: { $gte: sevenDaysAgo },
              percentage: { $exists: true, $ne: null }
            }
          },
          { $group: { _id: null, avgScore: { $avg: "$percentage" } } }
        ])
      ]);
      
      const standardAvg = standardScores[0]?.avgScore || 0;
      const satAvg = satScores[0]?.avgScore || 0;
      
      // Weighted average based on number of attempts
      const weightedAverage = totalStudentAttempts > 0 
        ? ((standardAvg * standardAttempts) + (satAvg * satAttempts)) / totalStudentAttempts
        : 0;
      
      averageScore = parseFloat(weightedAverage.toFixed(2));
    }

    console.log(`✅ Final Stats for ${schoolAdmin.schoolName}:`);
    console.log(`   Generated Assessments: ${totalGeneratedAssessments}`);
    console.log(`   Student Attempts: ${totalStudentAttempts}`);
    console.log(`   Active Teachers: ${activeTeachers}/${schoolTeachers.length}`);
    console.log(`   Active Students: ${activeStudents}/${studentCSVStats.total}`);

    // Send response
    res.json({
      success: true,
      stats: {
        generatedAssessments: {
          total: totalGeneratedAssessments,
          recent: recentUploads,
          activeTeachers: activeTeachers,
          inactiveTeachers: inactiveTeachers
        },
        studentAttempts: {
          total: totalStudentAttempts,
          activeStudents: activeStudents,
          inactiveStudents: inactiveStudents,
          recentAttempts: recentAttempts
        },
        analytics: {
          engagementRate: engagementRate,
          totalAssessments: totalGeneratedAssessments,
          averageScore: averageScore
        },
        students: {
          total: studentCSVStats.total || 0,
          active: activeStudents,
          pending: studentCSVStats.pending || 0,
          inactive: inactiveStudents
        },
        teachers: {
          total: teacherCSVStats.total || 0,
          active: activeTeachers,
          pending: teacherCSVStats.pending || 0,
          inactive: inactiveTeachers
        },
        schoolInfo: {
          name: schoolAdmin?.schoolName || "Your School",
          schoolId: schoolAdmin?.schoolId || "",
          totalStudents: studentCSVStats.total || 0,
          totalTeachers: teacherCSVStats.total || 0
        }
      }
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching dashboard statistics",
      error: error.message
    });
  }
});
module.exports = {
  registerSchoolAdmin,
  authSchoolAdmin,
  getSchoolAdminProfile,
  updateSchoolAdminProfile,
  updateSchoolAdminPassword,
  getDashboardStats,
};