const AssessmentSubmission = require("../models/webapp-models/assessmentSubmissionModel");
const AssessmentUpload = require("../models/webapp-models/assessmentuploadformModel");
const SatSubmission = require("../models/webapp-models/satSubmissionModel");
const SatAssessment = require("../models/webapp-models/satAssessmentModel");
const User = require("../models/webapp-models/userModel");

// ✅ Get all Standard Assessment attempts (Admin view)
exports.getAllStandardAttemptsForAdmin = async (req, res) => {
  try {
    const submissions = await AssessmentSubmission.find()
      .populate("studentId", "name email class")
      .populate("assessmentId", "assessmentName subject gradeLevel difficulty");

    const rows = submissions.map((s) => ({
      submissionId: s._id,
      studentId: s.studentId?._id,   // ✅ add this
      studentName: s.studentId?.name || "Unknown",
      studentEmail: s.studentId?.email || "Unknown",
      studentClass: s.studentId?.class || "N/A",
      assessmentTitle: s.assessmentId?.assessmentName || "Untitled",
      subject: s.assessmentId?.subject || "General",
      gradeLevel: s.assessmentId?.gradeLevel || "N/A",
      difficulty: s.assessmentId?.difficulty || "—",
      score: s.score,
      totalMarks: s.totalMarks,
      percentage: s.percentage,
      timeTaken: s.timeTaken,
      submittedAt: s.submittedAt,
    }));

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching standard attempts for admin:", err);
    res.status(500).json({ message: "Failed to fetch standard attempts" });
  }
};

// ✅ Get all SAT Assessment attempts (Admin view)
exports.getAllSatAttemptsForAdmin = async (req, res) => {
  try {
    const submissions = await SatSubmission.find()
      .populate("studentId", "name email class")
      .populate("assessmentId", "satTitle sectionType difficulty");

    const rows = submissions.map((s) => ({
      submissionId: s._id,
      studentId: s.studentId?._id,   // ✅ add this
      studentName: s.studentId?.name || "Unknown",
      studentEmail: s.studentId?.email || "Unknown",
      studentClass: s.studentId?.class || "N/A",
      assessmentTitle: s.assessmentId?.satTitle || "Untitled",
      sectionType: s.assessmentId?.sectionType || "General",
      difficulty: s.assessmentId?.difficulty || "—",
      score: s.score,
      totalMarks: s.totalMarks,
      percentage: s.percentage,
      timeTaken: s.timeTaken,
      submittedAt: s.submittedAt,
    }));

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching SAT attempts for admin:", err);
    res.status(500).json({ message: "Failed to fetch SAT attempts" });
  }
};


// ✅ Get performance profile for a specific student
exports.getStudentPerformanceProfile = async (req, res) => {
  try {
    const { studentId } = req.params;

    // Fetch both Standard & SAT submissions
    const standardSubmissions = await AssessmentSubmission.find({ studentId })
      .populate("assessmentId", "assessmentName subject gradeLevel difficulty");

    const satSubmissions = await SatSubmission.find({ studentId })
      .populate("assessmentId", "satTitle sectionType difficulty");

    // Merge attempts
    const allAttempts = [...standardSubmissions, ...satSubmissions];

    if (!allAttempts.length) {
      return res.status(404).json({ message: "No attempts found for this student" });
    }

    // Calculate averages
    const avgScore =
      allAttempts.reduce((acc, s) => acc + (s.percentage || 0), 0) /
      allAttempts.length;

    // Find best & weakest subjects (based on Standard assessments with subject info)
    const subjectStats = {};
    standardSubmissions.forEach((s) => {
      const subject = s.assessmentId?.subject || "General";
      if (!subjectStats[subject]) subjectStats[subject] = [];
      subjectStats[subject].push(s.percentage || 0);
    });

    let bestSubject = "N/A",
      weakestSubject = "N/A";
    if (Object.keys(subjectStats).length > 0) {
      const avgBySubject = Object.entries(subjectStats).map(([subj, scores]) => ({
        subj,
        avg: scores.reduce((a, b) => a + b, 0) / scores.length,
      }));
      avgBySubject.sort((a, b) => b.avg - a.avg);
      bestSubject = avgBySubject[0]?.subj || "N/A";
      weakestSubject = avgBySubject[avgBySubject.length - 1]?.subj || "N/A";
    }

    res.json({
      avgScore: avgScore.toFixed(2),
      bestSubject,
      weakestSubject,
      attempts: allAttempts.map((s) => ({
        id: s._id,
        type: s.assessmentId?.satTitle ? "SAT" : "Standard",
        title: s.assessmentId?.assessmentName || s.assessmentId?.satTitle || "Untitled",
        percentage: s.percentage,
        score: s.score,
        totalMarks: s.totalMarks,
        submittedAt: s.submittedAt,
      })),
    });
  } catch (err) {
    console.error("❌ Error fetching student profile:", err);
    res.status(500).json({ message: "Failed to fetch student performance" });
  }
};

