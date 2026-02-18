const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");

// Import ALL models
const AssessmentUpload = require("../models/webapp-models/assessmentuploadformModel");
const SatAssessment = require("../models/webapp-models/satAssessmentModel");
const AssessmentSubmission = require("../models/webapp-models/assessmentSubmissionModel");
const SatSubmission = require("../models/webapp-models/satSubmissionModel");
const SchoolStudentCSV = require("../models/webapp-models/schoolStudentCSVModel");
const SchoolTeacherCSV = require("../models/webapp-models/schoolTeacherCSVModel");

// Helper function to get date range
const getDateRange = (range = 'last30days') => {
  const now = new Date();
  let startDate = new Date();
  
  switch(range) {
    case 'today':
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'last7days':
      startDate.setDate(now.getDate() - 7);
      break;
    case 'last30days':
      startDate.setDate(now.getDate() - 30);
      break;
    case 'last90days':
      startDate.setDate(now.getDate() - 90);
      break;
    case 'thisMonth':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'lastMonth':
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endDate = new Date(now.getFullYear(), now.getMonth(), 0);
      return { startDate, endDate };
    default:
      startDate.setDate(now.getDate() - 30);
  }
  
  return { startDate, endDate: now };
};

// ==================== ASSESSMENT ANALYTICS (ENHANCED) ====================

// GET /api/school-admin/reports/assessment-analytics
const getAssessmentAnalytics = asyncHandler(async (req, res) => {
  try {
    const schoolId = req.user._id;
    const { range = 'last30days', subject, gradeLevel } = req.query;
    
    const dateRange = getDateRange(range);
    if (!dateRange) {
      return res.status(400).json({ message: "Invalid date range" });
    }

    const { startDate, endDate } = dateRange;

    console.log(`📊 Fetching assessment analytics for school: ${schoolId}`);
    console.log(`📅 Date range: ${startDate} to ${endDate}`);

    // ==================== GET STANDARD ASSESSMENTS ====================
    const standardMatchConditions = {
      schoolId: new mongoose.Types.ObjectId(schoolId),
      createdAt: { $gte: startDate, $lte: endDate }
    };

    if (subject) standardMatchConditions.subject = subject;
    if (gradeLevel) standardMatchConditions.gradeLevel = gradeLevel;

    // Get standard assessment counts by subject
    const standardAssessmentsBySubject = await AssessmentUpload.aggregate([
      { $match: standardMatchConditions },
      {
        $group: {
          _id: "$subject",
          count: { $sum: 1 },
          avgQuestions: { $avg: { $size: "$questions" } },
          avgTimeLimit: { $avg: "$timeLimit" },
          type: { $first: "Standard" }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // ==================== GET SAT ASSESSMENTS ====================
    const satMatchConditions = {
      schoolId: new mongoose.Types.ObjectId(schoolId),
      createdAt: { $gte: startDate, $lte: endDate }
    };

    const satAssessmentsByType = await SatAssessment.aggregate([
      { $match: satMatchConditions },
      {
        $group: {
          _id: "$assessmentType", // "English", "Math (Calculator)", "Math (No Calculator)"
          count: { $sum: 1 },
          avgQuestions: { $avg: { $size: "$questions" } },
          avgTimeLimit: { $avg: "$timeLimit" },
          type: { $first: "SAT" }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // ==================== COMBINE ASSESSMENTS ====================
    const allAssessmentsBySubject = [
      ...standardAssessmentsBySubject.map(item => ({
        subject: item._id || "Unknown",
        count: item.count,
        avgQuestions: Math.round(item.avgQuestions || 0),
        avgTimeLimit: Math.round(item.avgTimeLimit || 0),
        type: item.type
      })),
      ...satAssessmentsByType.map(item => ({
        subject: item._id || "Unknown",
        count: item.count,
        avgQuestions: Math.round(item.avgQuestions || 0),
        avgTimeLimit: Math.round(item.avgTimeLimit || 0),
        type: item.type
      }))
    ];

    console.log(`📚 All assessments by subject:`, allAssessmentsBySubject);

    // ==================== GET TOTAL ASSESSMENT COUNTS ====================
    const totalStandardAssessments = await AssessmentUpload.countDocuments({
      schoolId: new mongoose.Types.ObjectId(schoolId),
      createdAt: { $gte: startDate, $lte: endDate }
    });

    const totalSatAssessments = await SatAssessment.countDocuments({
      schoolId: new mongoose.Types.ObjectId(schoolId),
      createdAt: { $gte: startDate, $lte: endDate }
    });

    const totalAssessments = totalStandardAssessments + totalSatAssessments;

    // ==================== GET ASSESSMENTS BY DIFFICULTY ====================
    const standardAssessmentsByDifficulty = await AssessmentUpload.aggregate([
      { $match: standardMatchConditions },
      {
        $group: {
          _id: "$difficulty",
          count: { $sum: 1 },
          type: { $first: "Standard" }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // SAT assessments don't have difficulty field in your schema, so we'll handle it separately

    // ==================== GET MONTHLY TREND ====================
    // Get standard assessments trend
    const standardMonthlyTrend = await AssessmentUpload.aggregate([
      { $match: standardMatchConditions },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          period: {
            $concat: [
              { $toString: "$_id.year" },
              "-",
              { $toString: { $cond: [{ $lt: ["$_id.month", 10] }, { $concat: ["0", { $toString: "$_id.month" }] }, { $toString: "$_id.month" }] } }
            ]
          },
          assessments: "$count",
          type: "Standard"
        }
      },
      { $sort: { period: 1 } }
    ]);

    // Get SAT assessments trend
    const satMonthlyTrend = await SatAssessment.aggregate([
      { $match: satMatchConditions },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          period: {
            $concat: [
              { $toString: "$_id.year" },
              "-",
              { $toString: { $cond: [{ $lt: ["$_id.month", 10] }, { $concat: ["0", { $toString: "$_id.month" }] }, { $toString: "$_id.month" }] } }
            ]
          },
          assessments: "$count",
          type: "SAT"
        }
      },
      { $sort: { period: 1 } }
    ]);

    // Combine monthly trends
    const monthlyTrend = [...standardMonthlyTrend, ...satMonthlyTrend]
      .sort((a, b) => a.period.localeCompare(b.period));

    // ==================== GET TOP PERFORMING ASSESSMENTS ====================
    // Get standard assessment submissions
    const standardTopAssessments = await AssessmentSubmission.aggregate([
      {
        $match: {
          schoolId: new mongoose.Types.ObjectId(schoolId),
          submittedAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: "$assessmentId",
          avgScore: { $avg: "$percentage" },
          totalAttempts: { $sum: 1 },
          avgTimeTaken: { $avg: "$timeTaken" }
        }
      },
      {
        $lookup: {
          from: "assessmentuploads",
          localField: "_id",
          foreignField: "_id",
          as: "assessment"
        }
      },
      { $unwind: { path: "$assessment", preserveNullAndEmptyArrays: true } },
      {
        $match: {
          "assessment": { $ne: null }
        }
      },
      {
        $project: {
          _id: 0,
          assessmentId: "$_id",
          assessmentName: "$assessment.assessmentName",
          subject: "$assessment.subject",
          gradeLevel: "$assessment.gradeLevel",
          type: "Standard",
          avgScore: { $round: ["$avgScore", 2] },
          totalAttempts: 1,
          avgTimeTaken: { $round: ["$avgTimeTaken", 2] }
        }
      },
      { $sort: { avgScore: -1 } },
      { $limit: 10 }
    ]);

    // Get SAT assessment submissions
    const satTopAssessments = await SatSubmission.aggregate([
      {
        $match: {
          schoolId: new mongoose.Types.ObjectId(schoolId),
          submittedAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: "$assessmentId",
          avgScore: { $avg: "$percentage" },
          totalAttempts: { $sum: 1 },
          avgTimeTaken: { $avg: "$timeTaken" }
        }
      },
      {
        $lookup: {
          from: "satassessments",
          localField: "_id",
          foreignField: "_id",
          as: "assessment"
        }
      },
      { $unwind: { path: "$assessment", preserveNullAndEmptyArrays: true } },
      {
        $match: {
          "assessment": { $ne: null }
        }
      },
      {
        $project: {
          _id: 0,
          assessmentId: "$_id",
          assessmentName: "$assessment.assessmentName",
          subject: "$assessment.assessmentType", // SAT uses assessmentType instead of subject
          gradeLevel: "SAT",
          type: "SAT",
          avgScore: { $round: ["$avgScore", 2] },
          totalAttempts: 1,
          avgTimeTaken: { $round: ["$avgTimeTaken", 2] }
        }
      },
      { $sort: { avgScore: -1 } },
      { $limit: 10 }
    ]);

    // Combine top assessments
    const topAssessments = [...standardTopAssessments, ...satTopAssessments]
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, 10);

    // ==================== GET TEACHER INVOLVED ====================
    const standardTeachers = await AssessmentUpload.distinct("teacherId", {
      schoolId: new mongoose.Types.ObjectId(schoolId),
      createdAt: { $gte: startDate, $lte: endDate }
    });

    const satTeachers = await SatAssessment.distinct("teacherId", {
      schoolId: new mongoose.Types.ObjectId(schoolId),
      createdAt: { $gte: startDate, $lte: endDate }
    });

    const uniqueTeachers = [...new Set([...standardTeachers, ...satTeachers])];
    const totalTeachersInvolved = uniqueTeachers.length;

    res.json({
      success: true,
      data: {
        summary: {
          totalAssessments: totalAssessments,
          standardAssessments: totalStandardAssessments,
          satAssessments: totalSatAssessments,
          totalSubjects: allAssessmentsBySubject.length,
          avgQuestionsPerAssessment: allAssessmentsBySubject.length > 0 
            ? Math.round(allAssessmentsBySubject.reduce((sum, item) => sum + (item.avgQuestions || 0), 0) / allAssessmentsBySubject.length)
            : 0,
          totalTeachersInvolved: totalTeachersInvolved
        },
        bySubject: allAssessmentsBySubject,
        byDifficulty: standardAssessmentsByDifficulty.map(item => ({
          difficulty: item._id || "Unknown",
          count: item.count,
          type: item.type
        })),
        monthlyTrend: monthlyTrend,
        topAssessments: topAssessments,
        dateRange: {
          start: startDate,
          end: endDate,
          range: range
        }
      }
    });
  } catch (error) {
    console.error("❌ Error in assessment analytics:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching assessment analytics",
      error: error.message
    });
  }
});

// ==================== STUDENT PERFORMANCE ANALYTICS (ENHANCED) ====================

// GET /api/school-admin/reports/student-performance
const getStudentPerformance = asyncHandler(async (req, res) => {
  try {
    const schoolId = req.user._id;
    const { range = 'last30days', grade, subject } = req.query;
    
    const dateRange = getDateRange(range);
    if (!dateRange) {
      return res.status(400).json({ message: "Invalid date range" });
    }

    const { startDate, endDate } = dateRange;

    console.log(`📊 Fetching student performance for school: ${schoolId}`);

    // Get student counts from CSV
    const totalStudents = await SchoolStudentCSV.countDocuments({
      schoolAdmin: new mongoose.Types.ObjectId(schoolId),
      status: "active"
    });

    // ==================== GET STANDARD SUBMISSIONS ====================
    const standardSubmissions = await AssessmentSubmission.find({
      schoolId: new mongoose.Types.ObjectId(schoolId),
      submittedAt: { $gte: startDate, $lte: endDate }
    }).populate({
      path: 'assessmentId',
      select: 'gradeLevel subject assessmentName'
    });

    // ==================== GET SAT SUBMISSIONS ====================
    const satSubmissions = await SatSubmission.find({
      schoolId: new mongoose.Types.ObjectId(schoolId),
      submittedAt: { $gte: startDate, $lte: endDate }
    }).populate({
      path: 'assessmentId',
      select: 'assessmentType assessmentName'
    });

    // Combine all submissions
    const allSubmissions = [
      ...standardSubmissions.map(sub => ({
        ...sub.toObject(),
        type: 'Standard',
        subject: sub.assessmentId?.subject || 'Unknown',
        grade: sub.assessmentId?.gradeLevel || 'Unknown'
      })),
      ...satSubmissions.map(sub => ({
        ...sub.toObject(),
        type: 'SAT',
        subject: sub.assessmentId?.assessmentType || 'SAT',
        grade: 'SAT'
      }))
    ];

    // Group by grade
    const gradeMap = {};
    const subjectMap = {};
    const scores = [];
    
    allSubmissions.forEach(sub => {
      if (sub.assessmentId) {
        const grade = sub.grade || "Unknown";
        const subject = sub.subject || "Unknown";
        
        // Grade performance
        if (!gradeMap[grade]) {
          gradeMap[grade] = { totalScore: 0, count: 0, totalTime: 0 };
        }
        gradeMap[grade].totalScore += sub.percentage || 0;
        gradeMap[grade].count++;
        gradeMap[grade].totalTime += sub.timeTaken || 0;
        
        // Subject performance
        if (!subjectMap[subject]) {
          subjectMap[subject] = { totalScore: 0, count: 0, totalTime: 0 };
        }
        subjectMap[subject].totalScore += sub.percentage || 0;
        subjectMap[subject].count++;
        subjectMap[subject].totalTime += sub.timeTaken || 0;
        
        // Score distribution
        if (sub.percentage !== undefined && sub.percentage !== null) {
          scores.push(sub.percentage);
        }
      }
    });

    // Format grade performance
    const gradePerformance = [];
    for (const [grade, data] of Object.entries(gradeMap)) {
      const totalStudentsInGrade = await SchoolStudentCSV.countDocuments({
        schoolAdmin: new mongoose.Types.ObjectId(schoolId),
        grade: grade,
        status: "active"
      });
      
      gradePerformance.push({
        grade: grade,
        avgScore: data.count > 0 ? Math.round((data.totalScore / data.count) * 100) / 100 : 0,
        totalAttempts: data.count,
        totalStudents: totalStudentsInGrade,
        avgTimeTaken: data.count > 0 ? Math.round(data.totalTime / data.count) : 0
      });
    }

    // Format subject performance
    const subjectPerformance = Object.entries(subjectMap).map(([subject, data]) => ({
      subject: subject,
      avgScore: data.count > 0 ? Math.round((data.totalScore / data.count) * 100) / 100 : 0,
      totalAttempts: data.count,
      avgTimeTaken: data.count > 0 ? Math.round(data.totalTime / data.count) : 0
    }));

    // Get students with attempts
    const standardStudents = [...new Set(standardSubmissions.map(s => s.studentId?.toString()))].filter(Boolean);
    const satStudents = [...new Set(satSubmissions.map(s => s.studentId?.toString()))].filter(Boolean);
    const uniqueStudents = [...new Set([...standardStudents, ...satStudents])];
    
    const completionRate = totalStudents > 0 
      ? Math.round((uniqueStudents.length / totalStudents) * 100)
      : 0;

    // Calculate overall average
    const overallAvgScore = scores.length > 0 
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 100) / 100
      : 0;

    // Calculate score distribution
    const scoreDistribution = [];
    if (scores.length > 0) {
      const ranges = [
        { min: 0, max: 30, label: "0-30%" },
        { min: 31, max: 50, label: "31-50%" },
        { min: 51, max: 70, label: "51-70%" },
        { min: 71, max: 90, label: "71-90%" },
        { min: 91, max: 100, label: "91-100%" }
      ];
      
      ranges.forEach(range => {
        const filteredScores = scores.filter(score => score >= range.min && score <= range.max);
        if (filteredScores.length > 0) {
          const avg = filteredScores.reduce((a, b) => a + b, 0) / filteredScores.length;
          scoreDistribution.push({
            range: range.label,
            count: filteredScores.length,
            avgPercentage: Math.round(avg * 100) / 100,
            percentage: Math.round((filteredScores.length / scores.length) * 100)
          });
        }
      });
    }

    res.json({
      success: true,
      data: {
        summary: {
          totalStudents: totalStudents,
          activeStudents: uniqueStudents.length,
          completionRate: completionRate,
          overallAvgScore: overallAvgScore,
          totalAttempts: allSubmissions.length
        },
        gradePerformance: gradePerformance,
        subjectPerformance: subjectPerformance,
        scoreDistribution: scoreDistribution,
        dateRange: {
          start: startDate,
          end: endDate,
          range: range
        }
      }
    });
  } catch (error) {
    console.error("❌ Error in student performance analytics:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching student performance analytics",
      error: error.message
    });
  }
});

// ==================== USER ENGAGEMENT ANALYTICS ====================

// GET /api/school-admin/reports/user-engagement
const getUserEngagement = asyncHandler(async (req, res) => {
  try {
    const schoolId = req.user._id;
    const { range = 'last30days' } = req.query;
    
    const dateRange = getDateRange(range);
    if (!dateRange) {
      return res.status(400).json({ message: "Invalid date range" });
    }

    const { startDate, endDate } = dateRange;

    console.log(`📊 Fetching user engagement for school: ${schoolId}`);

    // Get student stats
    const studentStats = await SchoolStudentCSV.aggregate([
      {
        $match: {
          schoolAdmin: new mongoose.Types.ObjectId(schoolId)
        }
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);

    // Get teacher stats
    const teacherStats = await SchoolTeacherCSV.aggregate([
      {
        $match: {
          schoolAdmin: new mongoose.Types.ObjectId(schoolId)
        }
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);

    // Get active students with attempts (both Standard and SAT)
    const standardStudentsWithAttempts = await AssessmentSubmission.distinct("studentId", {
      schoolId: new mongoose.Types.ObjectId(schoolId),
      submittedAt: { $gte: startDate, $lte: endDate }
    });

    const satStudentsWithAttempts = await SatSubmission.distinct("studentId", {
      schoolId: new mongoose.Types.ObjectId(schoolId),
      submittedAt: { $gte: startDate, $lte: endDate }
    });

    const allStudentsWithAttempts = [...new Set([...standardStudentsWithAttempts, ...satStudentsWithAttempts])];

    // Get teachers with created assessments (both Standard and SAT)
    const teachersWithStandardAssessments = await AssessmentUpload.distinct("teacherId", {
      schoolId: new mongoose.Types.ObjectId(schoolId),
      createdAt: { $gte: startDate, $lte: endDate }
    });

    const teachersWithSatAssessments = await SatAssessment.distinct("teacherId", {
      schoolId: new mongoose.Types.ObjectId(schoolId),
      createdAt: { $gte: startDate, $lte: endDate }
    });

    const allTeachersWithAssessments = [...new Set([...teachersWithStandardAssessments, ...teachersWithSatAssessments])];

    // Calculate engagement rates
    const activeStudents = studentStats.find(s => s._id === "active")?.count || 0;
    const studentEngagementRate = activeStudents > 0 
      ? Math.round((allStudentsWithAttempts.length / activeStudents) * 100)
      : 0;

    const activeTeachers = teacherStats.find(t => t._id === "active")?.count || 0;
    const teacherEngagementRate = activeTeachers > 0 
      ? Math.round((allTeachersWithAssessments.length / activeTeachers) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        summary: {
          totalStudents: studentStats.reduce((sum, item) => sum + item.count, 0),
          activeStudents: activeStudents,
          studentEngagementRate: studentEngagementRate,
          totalTeachers: teacherStats.reduce((sum, item) => sum + item.count, 0),
          activeTeachers: activeTeachers,
          teacherEngagementRate: teacherEngagementRate,
          overallEngagementRate: Math.round((studentEngagementRate + teacherEngagementRate) / 2)
        },
        dateRange: {
          start: startDate,
          end: endDate,
          range: range
        }
      }
    });
  } catch (error) {
    console.error("❌ Error in user engagement analytics:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user engagement analytics",
      error: error.message
    });
  }
});

// ==================== USAGE TRENDS ANALYTICS (ENHANCED) ====================

// GET /api/school-admin/reports/usage-trends
const getUsageTrends = asyncHandler(async (req, res) => {
  try {
    const schoolId = req.user._id;
    const { range = 'last30days' } = req.query;
    
    const dateRange = getDateRange(range);
    if (!dateRange) {
      return res.status(400).json({ message: "Invalid date range" });
    }

    const { startDate, endDate } = dateRange;

    console.log(`📊 Fetching usage trends for school: ${schoolId}`);

    // ==================== GET ASSESSMENTS CREATED (BOTH TYPES) ====================
    const standardAssessmentsCreated = await AssessmentUpload.countDocuments({
      schoolId: new mongoose.Types.ObjectId(schoolId),
      createdAt: { $gte: startDate, $lte: endDate }
    });

    const satAssessmentsCreated = await SatAssessment.countDocuments({
      schoolId: new mongoose.Types.ObjectId(schoolId),
      createdAt: { $gte: startDate, $lte: endDate }
    });

    const totalAssessmentsCreated = standardAssessmentsCreated + satAssessmentsCreated;

    // ==================== GET ATTEMPTS MADE (BOTH TYPES) ====================
    const standardAttemptsData = await AssessmentSubmission.aggregate([
      {
        $match: {
          schoolId: new mongoose.Types.ObjectId(schoolId),
          submittedAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalAttempts: { $sum: 1 },
          avgScore: { $avg: "$percentage" },
          totalTime: { $sum: "$timeTaken" }
        }
      }
    ]);

    const satAttemptsData = await SatSubmission.aggregate([
      {
        $match: {
          schoolId: new mongoose.Types.ObjectId(schoolId),
          submittedAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalAttempts: { $sum: 1 },
          avgScore: { $avg: "$percentage" },
          totalTime: { $sum: "$timeTaken" }
        }
      }
    ]);

    const totalStandardAttempts = standardAttemptsData[0]?.totalAttempts || 0;
    const totalSatAttempts = satAttemptsData[0]?.totalAttempts || 0;
    const totalAttempts = totalStandardAttempts + totalSatAttempts;

    const totalTime = (standardAttemptsData[0]?.totalTime || 0) + (satAttemptsData[0]?.totalTime || 0);
    const totalStudyHours = totalTime ? Math.round((totalTime / 3600) * 100) / 100 : 0;

    // Calculate overall average score
    const totalStandardScore = (standardAttemptsData[0]?.avgScore || 0) * totalStandardAttempts;
    const totalSatScore = (satAttemptsData[0]?.avgScore || 0) * totalSatAttempts;
    const overallAvgScore = totalAttempts > 0 
      ? Math.round(((totalStandardScore + totalSatScore) / totalAttempts) * 100) / 100 
      : 0;

    // Calculate days in range for average
    const daysInRange = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    const avgAttemptsPerDay = daysInRange > 0 ? Math.round(totalAttempts / daysInRange) : 0;

    res.json({
      success: true,
      data: {
        summary: {
          totalAssessmentsCreated: totalAssessmentsCreated,
          standardAssessmentsCreated: standardAssessmentsCreated,
          satAssessmentsCreated: satAssessmentsCreated,
          totalAttemptsMade: totalAttempts,
          standardAttemptsMade: totalStandardAttempts,
          satAttemptsMade: totalSatAttempts,
          overallAvgScore: overallAvgScore,
          totalStudyHours: totalStudyHours,
          avgAttemptsPerDay: avgAttemptsPerDay
        },
        dateRange: {
          start: startDate,
          end: endDate,
          range: range
        }
      }
    });
  } catch (error) {
    console.error("❌ Error in usage trends analytics:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching usage trends analytics",
      error: error.message
    });
  }
});

// ==================== EXPORT REPORTS ====================

// GET /api/school-admin/reports/export
const exportReports = asyncHandler(async (req, res) => {
  try {
    const schoolId = req.user._id;
    const { reportType, format = 'json', range = 'last30days' } = req.query;
    
    res.json({
      success: true,
      message: "Export functionality will be implemented separately",
      reportType,
      format,
      range
    });
  } catch (error) {
    console.error("Error exporting reports:", error);
    res.status(500).json({
      success: false,
      message: "Error exporting reports",
      error: error.message
    });
  }
});

module.exports = {
  getAssessmentAnalytics,
  getStudentPerformance,
  getUserEngagement,
  getUsageTrends,
  exportReports
};