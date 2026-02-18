const asyncHandler = require("express-async-handler");
const AssessmentSubmission = require("../models/webapp-models/assessmentSubmissionModel");
const SatSubmission = require("../models/webapp-models/satSubmissionModel");
const Userwebapp = require("../models/webapp-models/userModel");

// @desc    Get all assessment attempts for school admin's school
// @route   GET /api/school-admin/attempts
// @access  Private (School Admin)
const getSchoolAttempts = asyncHandler(async (req, res) => {
  try {
    const schoolAdminId = req.user._id;
    
    // Get query parameters
    const { 
      type = "all", // "standard", "sat", or "all"
      studentId,
      page = 1,
      limit = 20,
      startDate,
      endDate,
      sortBy = "submittedAt",
      sortOrder = "desc"
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Build date filter
    const dateFilter = {};
    if (startDate) {
      dateFilter.$gte = new Date(startDate);
    }
    if (endDate) {
      dateFilter.$lte = new Date(endDate);
    }

    // Build base query
    const baseQuery = { 
      schoolId: schoolAdminId,
      ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
    };

    let standardAttempts = [];
    let satAttempts = [];
    let totalStandard = 0;
    let totalSat = 0;

    // Fetch standard assessments if requested
    if (type === "all" || type === "standard") {
      const standardQuery = { ...baseQuery };
      if (studentId) {
        standardQuery.studentId = studentId;
      }

      [standardAttempts, totalStandard] = await Promise.all([
        AssessmentSubmission.find(standardQuery)
          .populate({
            path: "studentId",
            select: "name email class",
            match: { schoolId: schoolAdminId } // Only CSV-uploaded students
          })
          .populate({
            path: "assessmentId",
            select: "assessmentName subject gradeLevel difficulty",
            match: { teacherId: { $exists: true } } // Ensure it's a valid assessment
          })
          .sort(sort)
          .skip(skip)
          .limit(type === "standard" ? parseInt(limit) : parseInt(limit) / 2)
          .lean(),
        AssessmentSubmission.countDocuments(standardQuery)
      ]);

      // Filter out submissions where student doesn't belong to this school
      standardAttempts = standardAttempts.filter(
        attempt => attempt.studentId && attempt.assessmentId
      );
    }

    // Fetch SAT assessments if requested
    if (type === "all" || type === "sat") {
      const satQuery = { ...baseQuery };
      if (studentId) {
        satQuery.studentId = studentId;
      }

      [satAttempts, totalSat] = await Promise.all([
        SatSubmission.find(satQuery)
          .populate({
            path: "studentId",
            select: "name email class",
            match: { schoolId: schoolAdminId } // Only CSV-uploaded students
          })
          .populate({
            path: "assessmentId",
            select: "satTitle sectionType difficulty",
            match: { teacherId: { $exists: true } }
          })
          .sort(sort)
          .skip(skip)
          .limit(type === "sat" ? parseInt(limit) : parseInt(limit) / 2)
          .lean(),
        SatSubmission.countDocuments(satQuery)
      ]);

      // Filter out submissions where student doesn't belong to this school
      satAttempts = satAttempts.filter(
        attempt => attempt.studentId && attempt.assessmentId
      );
    }

    // Combine results
    const allAttempts = [...standardAttempts, ...satAttempts];
    const total = totalStandard + totalSat;

    // Format response
const formattedAttempts = allAttempts.map(attempt => {
  const isSat = attempt.satTitle || attempt.sectionType;
  return {
    _id: attempt._id,
    type: isSat ? "sat" : "standard",
    assessmentName: isSat 
      ? attempt.assessmentId?.satTitle || "SAT Assessment"
      : attempt.assessmentId?.assessmentName || "Standard Assessment",
    subject: isSat 
      ? attempt.assessmentId?.sectionType 
      : attempt.assessmentId?.subject,
    difficulty: attempt.assessmentId?.difficulty,
    studentName: attempt.studentId?.name || "Unknown Student",
    studentEmail: attempt.studentId?.email || "No Email",
    studentClass: attempt.studentId?.class || "N/A",
    score: attempt.score,
    totalMarks: attempt.totalMarks,
    percentage: attempt.percentage,
    timeTaken: attempt.timeTaken,
    // FIXED: Use submittedAt first, fallback to createdAt
    submittedAt: attempt.submittedAt || attempt.createdAt,
    proctoringMode: attempt.proctoringData?.mode || "test"
  };
});
    // Sort combined results if needed
    if (type === "all") {
      formattedAttempts.sort((a, b) => {
        if (sortBy === "submittedAt") {
          return sortOrder === "asc" 
            ? new Date(a.submittedAt) - new Date(b.submittedAt)
            : new Date(b.submittedAt) - new Date(a.submittedAt);
        }
        return 0;
      });
    }

    res.json({
      success: true,
      attempts: formattedAttempts,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      },
      summary: {
        standard: totalStandard,
        sat: totalSat,
        total: total
      }
    });
  } catch (error) {
    console.error("Error fetching school attempts:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch assessment attempts",
      error: error.message
    });
  }
});

// @desc    Get attempt statistics for school admin dashboard
// @route   GET /api/school-admin/attempts/stats
// @access  Private (School Admin)
const getAttemptStats = asyncHandler(async (req, res) => {
  try {
    const schoolAdminId = req.user._id;
    
    // Get date range (last 30 days by default)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Fetch statistics for standard assessments
    const standardStats = await AssessmentSubmission.aggregate([
      {
        $match: {
          schoolId: schoolAdminId,
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: null,
          totalAttempts: { $sum: 1 },
          totalScore: { $sum: "$score" },
          totalMarks: { $sum: "$totalMarks" },
          avgPercentage: { $avg: "$percentage" },
          uniqueStudents: { $addToSet: "$studentId" }
        }
      },
      {
        $project: {
          totalAttempts: 1,
          avgPercentage: { $round: ["$avgPercentage", 2] },
          uniqueStudentsCount: { $size: "$uniqueStudents" },
          totalScore: 1,
          totalMarks: 1
        }
      }
    ]);

    // Fetch statistics for SAT assessments
    const satStats = await SatSubmission.aggregate([
      {
        $match: {
          schoolId: schoolAdminId,
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: null,
          totalAttempts: { $sum: 1 },
          totalScore: { $sum: "$score" },
          totalMarks: { $sum: "$totalMarks" },
          avgPercentage: { $avg: "$percentage" },
          uniqueStudents: { $addToSet: "$studentId" }
        }
      },
      {
        $project: {
          totalAttempts: 1,
          avgPercentage: { $round: ["$avgPercentage", 2] },
          uniqueStudentsCount: { $size: "$uniqueStudents" },
          totalScore: 1,
          totalMarks: 1
        }
      }
    ]);

    const standardData = standardStats[0] || {
      totalAttempts: 0,
      avgPercentage: 0,
      uniqueStudentsCount: 0,
      totalScore: 0,
      totalMarks: 0
    };

    const satData = satStats[0] || {
      totalAttempts: 0,
      avgPercentage: 0,
      uniqueStudentsCount: 0,
      totalScore: 0,
      totalMarks: 0
    };

    // Calculate overall statistics
    const totalAttempts = standardData.totalAttempts + satData.totalAttempts;
    const totalStudents = standardData.uniqueStudentsCount + satData.uniqueStudentsCount;
    const overallAvgPercentage = totalAttempts > 0 
      ? ((standardData.avgPercentage * standardData.totalAttempts + 
          satData.avgPercentage * satData.totalAttempts) / totalAttempts).toFixed(2)
      : 0;

    // Get recent attempts (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentStandardAttempts = await AssessmentSubmission.countDocuments({
      schoolId: schoolAdminId,
      createdAt: { $gte: sevenDaysAgo }
    });

    const recentSatAttempts = await SatSubmission.countDocuments({
      schoolId: schoolAdminId,
      createdAt: { $gte: sevenDaysAgo }
    });

    res.json({
      success: true,
      stats: {
        overall: {
          totalAttempts,
          totalStudents,
          averageScore: parseFloat(overallAvgPercentage),
          recentAttempts: recentStandardAttempts + recentSatAttempts
        },
        standard: {
          totalAttempts: standardData.totalAttempts,
          averageScore: standardData.avgPercentage,
          uniqueStudents: standardData.uniqueStudentsCount,
          totalScore: standardData.totalScore,
          totalMarks: standardData.totalMarks
        },
        sat: {
          totalAttempts: satData.totalAttempts,
          averageScore: satData.avgPercentage,
          uniqueStudents: satData.uniqueStudentsCount,
          totalScore: satData.totalScore,
          totalMarks: satData.totalMarks
        }
      }
    });
  } catch (error) {
    console.error("Error fetching attempt stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch attempt statistics",
      error: error.message
    });
  }
});

// @desc    Get detailed view of a specific attempt
// @route   GET /api/school-admin/attempts/:id
// @access  Private (School Admin)
const getAttemptDetails = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const schoolAdminId = req.user._id;

    // Try to find in standard assessments first
    let attempt = await AssessmentSubmission.findOne({
      _id: id,
      schoolId: schoolAdminId
    })
      .populate({
        path: "studentId",
        select: "name email class mobile city",
        match: { schoolId: schoolAdminId }
      })
      .populate({
        path: "assessmentId",
        select: "assessmentName subject gradeLevel difficulty timeLimit questions",
        populate: {
          path: "teacherId",
          select: "name email",
          match: { schoolId: schoolAdminId }
        }
      })
      .lean();

    let attemptType = "standard";

    // If not found in standard, try SAT assessments
    if (!attempt) {
      attempt = await SatSubmission.findOne({
        _id: id,
        schoolId: schoolAdminId
      })
        .populate({
          path: "studentId",
          select: "name email class mobile city",
          match: { schoolId: schoolAdminId }
        })
        .populate({
          path: "assessmentId",
          select: "satTitle sectionType difficulty timeLimit questions",
          populate: {
            path: "teacherId",
            select: "name email",
            match: { schoolId: schoolAdminId }
          }
        })
        .lean();
      attemptType = "sat";
    }

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: "Attempt not found or you don't have permission to view it"
      });
    }

    // Filter out any null references (students/teachers not in this school)
    if (!attempt.studentId || !attempt.assessmentId) {
      return res.status(403).json({
        success: false,
        message: "This attempt belongs to a user outside your school"
      });
    }

    // Format response
    const formattedAttempt = {
      _id: attempt._id,
      type: attemptType,
      assessmentName: attemptType === "standard" 
        ? attempt.assessmentId.assessmentName
        : attempt.assessmentId.satTitle,
      subject: attemptType === "standard"
        ? attempt.assessmentId.subject
        : attempt.assessmentId.sectionType,
      difficulty: attempt.assessmentId.difficulty,
      timeLimit: attempt.assessmentId.timeLimit,
      student: {
        name: attempt.studentId.name,
        email: attempt.studentId.email,
        class: attempt.studentId.class,
        mobile: attempt.studentId.mobile,
        city: attempt.studentId.city
      },
      teacher: attempt.assessmentId.teacherId ? {
        name: attempt.assessmentId.teacherId.name,
        email: attempt.assessmentId.teacherId.email
      } : null,
      score: attempt.score,
      totalMarks: attempt.totalMarks,
      percentage: attempt.percentage,
      timeTaken: attempt.timeTaken,
      submittedAt: attempt.createdAt,
      proctoringData: attempt.proctoringData,
      responses: attempt.responses.map((response, index) => ({
        questionNumber: index + 1,
        questionText: response.questionText,
        options: response.options || [],
        correctAnswer: response.correctAnswer,
        studentAnswer: response.studentAnswer,
        isCorrect: response.isCorrect,
        marks: response.marks,
        type: response.type || "mcq"
      }))
    };

    res.json({
      success: true,
      attempt: formattedAttempt
    });
  } catch (error) {
    console.error("Error fetching attempt details:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch attempt details",
      error: error.message
    });
  }
});

module.exports = {
  getSchoolAttempts,
  getAttemptStats,
  getAttemptDetails
};