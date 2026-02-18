const asyncHandler = require("express-async-handler");
const AssessmentUpload = require("../models/webapp-models/assessmentuploadformModel");
const AssessmentSubmission = require('../models/webapp-models/assessmentSubmissionModel');
const Userwebapp = require("../models/webapp-models/userModel");
const { uploadToS3, getSignedUrl, deleteFromS3 } = require("../config/s3Upload");
const { parsePDFToQuestions } = require('../utils/pdfParser');
const Feedback = require("../models/webapp-models/FeedbackModel");
const { generateScoreReportPDF } = require("../utils/scoreReport");
const sendEmail = require("../utils/mailer");
const Teacher = require("../models/webapp-models/teacherModel");

// ✅ ADD THIS IMPORT
const { createSchoolAdminNotification } = require("./schoolAdminNotificationController");


// @desc    Upload assessment and parse questions
// @route   POST /api/assessments/upload
// @access  Private (Teacher)
const uploadAssessment = asyncHandler(async (req, res) => {
  const { assessmentName, subject, gradeLevel, timeLimit } = req.body;
  const file = req.file;

  if (!file) {
    res.status(400);
    throw new Error("File is required");
  }

  if (!req.user || req.user.role !== "teacher") {
    res.status(403);
    throw new Error("Only teachers can upload assessments");
  }

  // 🆕 GET TEACHER'S SCHOOL ID
  const teacher = await Teacher.findById(req.user._id).select("schoolId");
  const schoolId = teacher.schoolId;

  // Determine file type
  const fileType = file.mimetype === 'text/markdown' || file.originalname.endsWith('.md') ? 'markdown' : 'pdf';

  // Upload to S3
  const { key } = await uploadToS3(file);

  // Parse questions based on file type
  const questions = await parsePDFToQuestions(file.buffer, fileType);
  if (!questions || questions.length === 0) {
    res.status(400);
    throw new Error(`No questions extracted from ${fileType.toUpperCase()} file.`);
  }

  // Create 4 difficulty versions
  const difficulties = ["easy", "medium", "hard", "very hard"];
  const createdAssessments = [];

  for (const difficulty of difficulties) {
    const assessment = await AssessmentUpload.create({
      teacherId: req.user._id,
      // 🆕 ADD SCHOOL ID TO ASSESSMENT
      schoolId: schoolId,
      assessmentName,
      subject,
      gradeLevel,
      fileUrl: key,
      questions,
      timeLimit: timeLimit || 30,
      difficulty,
      isApproved: false,
      fileType
    });
    createdAssessments.push(assessment);
  }

  // ✅ ADD NOTIFICATION FOR SCHOOL ADMIN
  if (schoolId) {
    await createSchoolAdminNotification(schoolId, {
      type: "assessment_generated",
      title: "New Assessment Generated",
      message: `Teacher uploaded "${assessmentName}" with ${questions.length} questions`,
      data: {
        teacherId: req.user._id,
        assessmentName: assessmentName,
        subject: subject,
        gradeLevel: gradeLevel,
        difficultyLevels: difficulties.length,
        questionCount: questions.length,
        fileType: fileType
      },
      relatedUserId: req.user._id,
      relatedAssessmentId: createdAssessments[0]._id
    });
  }

  res.status(201).json({
    message: `Assessment uploaded with all difficulty levels from ${fileType.toUpperCase()}. Pending review.`,
    assessments: createdAssessments
  });
});

//approve assessment controller
const approveAssessment = asyncHandler(async (req, res) => {
  const assessment = await AssessmentUpload.findById(req.params.id);

  if (!assessment) {
    res.status(404);
    throw new Error("Assessment not found");
  }

  if (assessment.teacherId.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Not authorized to approve this assessment");
  }

  assessment.isApproved = true;
  await assessment.save();

  res.json({ message: "Assessment approved", status: assessment.isApproved });
});

//Assessment Review controller
const getAssessmentForReview = asyncHandler(async (req, res) => {
  const assessment = await AssessmentUpload.findById(req.params.id);

  if (!assessment) {
    res.status(404);
    throw new Error("Assessment not found");
  }

  if (assessment.teacherId.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Unauthorized");
  }

  res.json(assessment);
});

//assessment update controller
const updateAssessmentQuestions = asyncHandler(async (req, res) => {
  const { questions } = req.body;
  const assessment = await AssessmentUpload.findById(req.params.id);

  if (!assessment) {
    res.status(404);
    throw new Error("Assessment not found");
  }

  if (assessment.teacherId.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Unauthorized");
  }

  assessment.questions = questions;
  await assessment.save();

  res.json({ message: "Questions updated", assessment });
});


// @desc    Get assessments of logged in teacher
// @route   GET /api/assessments/my
// @access  Private (Teacher)
const getTeacherAssessments = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = { teacherId: req.user._id };

  // Apply status-based filtering
  if (status === "pending") {
    filter.isApproved = false;
  } else if (status === "approved") {
    filter.isApproved = true;
  }

  const assessments = await AssessmentUpload.find(filter).sort({ createdAt: -1 });

  const assessmentsWithUrls = await Promise.all(
    assessments.map(async (a) => ({
      ...a._doc,
      signedUrl: a.fileUrl ? await getSignedUrl(a.fileUrl) : null,
      submissionCount: await AssessmentSubmission.countDocuments({ assessmentId: a._id }),
    }))
  );

  res.json(assessmentsWithUrls);
});


// @desc    Delete assessment
// @route   DELETE /api/assessments/:id
// @access  Private (Teacher)
const deleteAssessment = asyncHandler(async (req, res) => {
  const assessment = await AssessmentUpload.findById(req.params.id);

  if (!assessment) {
    res.status(404);
    throw new Error('Assessment not found');
  }

  // Verify ownership
  if (assessment.teacherId.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized to delete this assessment');
  }

  // Delete from S3
  if (assessment.fileUrl) {
    try {
      await deleteFromS3(assessment.fileUrl);
    } catch (s3Error) {
      console.error("S3 Deletion Error:", s3Error);
      res.status(500);
      throw new Error('Failed to delete file from storage');
    }
  }

  // Delete all related submissions
  await AssessmentSubmission.deleteMany({ assessmentId: assessment._id });

  // Delete from database
  await assessment.deleteOne();

  res.json({ 
    message: 'Assessment deleted successfully',
    id: req.params.id 
  });
});

// @desc    Get all assessments (for students)
// @route   GET /api/assessments/all
// @access  Private (Student)
const getAllAssessments = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    let studentClass = req.user.class; // Could be "11" or "11th"

    // Only students need filtering by class
    let assessmentsQuery = {};
    if (userRole === "student") {
      // Normalize class: remove "th" if present
      const normalizedClass = studentClass.replace(/th$/, '');

      // Validate
      if (!["9", "10", "11", "12"].includes(normalizedClass)) {
        return res.status(400).json({ message: "Invalid student class" });
      }

      // Use normalized class for query
      assessmentsQuery = {
        gradeLevel: normalizedClass,
        isApproved: true
      };
    }

    // Fetch assessments
    const assessments = await AssessmentUpload.find(assessmentsQuery).lean();

    // Fetch user's submissions
    const submissions = await AssessmentSubmission.find({
      studentId: userId,
    }).select("assessmentId score totalMarks");

    // Map submissions for quick lookup
    const submittedMap = {};
    submissions.forEach((s) => {
      submittedMap[s.assessmentId.toString()] = {
        score: s.score,
        totalMarks: s.totalMarks,
      };
    });

    // Enrich assessments with submission info
    const enriched = assessments.map((a) => ({
      ...a,
      submission: submittedMap[a._id.toString()] || null,
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch assessments" });
  }
};


// @desc    Get assessment for attempt (without correct answers)
// @route   GET /api/assessments/:id/attempt
// @access  Private (Student)
const getAssessmentForAttempt = asyncHandler(async (req, res) => {
  const assessment = await AssessmentUpload.findById(req.params.id)
    .select('-questions.correctAnswer'); // Exclude correct answers

  if (!assessment) {
    res.status(404);
    throw new Error('Assessment not found');
  }

  // Check if student already submitted
  const existingSubmission = await AssessmentSubmission.findOne({
    assessmentId: assessment._id,
    studentId: req.user._id
  });

  if (existingSubmission) {
    res.status(400);
    throw new Error('You have already submitted this assessment');
  }

  res.json({
    ...assessment._doc,
    signedUrl: assessment.fileUrl ? await getSignedUrl(assessment.fileUrl) : null
  });
});

// @desc    Submit assessment answers
// @route   POST /api/assessments/:id/submit
// @access  Private (Student)
const submitAssessment = asyncHandler(async (req, res) => {
  const { answers, timeTaken, mode = "test" } = req.body;
  const assessmentId = req.params.id;
  const studentId = req.user._id;

  const assessment = await AssessmentUpload.findById(assessmentId);
  if (!assessment) {
    res.status(404);
    throw new Error('Assessment not found');
  }

  // ✅ GET STUDENT'S SCHOOL ID
  const student = await Userwebapp.findById(studentId).select("schoolId");
  const schoolId = student.schoolId;

  const existingSubmission = await AssessmentSubmission.findOne({ assessmentId, studentId });
  if (existingSubmission) {
    res.status(400);
    throw new Error('You have already submitted this assessment');
  }

  if (!answers || answers.length !== assessment.questions.length) {
    res.status(400);
    throw new Error('Number of answers does not match number of questions');
  }

  let score = 0;
  const responses = assessment.questions.map((question, index) => {
    const studentAnswer = parseInt(answers[index]);
    const correctAnswer = parseInt(question.correctAnswer);
    const isCorrect = studentAnswer === correctAnswer;
    const marks = question.marks || 1;

    if (isCorrect) score += marks;

    return {
      questionText: question.questionText,
      options: question.options,
      correctAnswer,
      studentAnswer,
      isCorrect,
      marks,
      topic: question.topic || "",
    };
  });

  const totalMarks = assessment.questions.reduce((sum, q) => sum + (q.marks || 1), 0);
  const percentage = totalMarks > 0 ? (score / totalMarks) * 100 : 0;

  const submission = await AssessmentSubmission.create({
    assessmentId,
    studentId,
    // ✅ ADD SCHOOL ID TO SUBMISSION
    schoolId: schoolId,
    responses,
    score,
    totalMarks,
    percentage: parseFloat(percentage.toFixed(2)),
    timeTaken,
    proctoringData: {
      mode: mode,
      violationCount: 0,
      sessionDuration: timeTaken
    }
  });
// ADD THIS AFTER submission creation:
const user = await Userwebapp.findById(studentId);
await user.syncTotalAttempts();
  
  
  // ✅ Generate PDF + Send Email
  try {
  const student = await Userwebapp.findById(studentId).select("name email");
  if (student && student.email) {
    const pdfBuffer = await generateScoreReportPDF(
      submission,
      student,
      assessment,
      "standard"
    );

    await sendEmail.sendScoreReportEmail(
      student.email,
      student.name || "Student",
      pdfBuffer,
      "standard"
    );
  } else {
    console.warn("⚠️ Student email not found; skipping score report send.");
  }
} catch (err) {
  console.error("❌ Failed to generate/send standard score report:", err);
  // Don't throw → keep submission success even if email fails
}

  // ✅ ADD NOTIFICATION FOR SCHOOL ADMIN
  if (schoolId) {
    const student = await Userwebapp.findById(studentId).select("name");
    
    await createSchoolAdminNotification(schoolId, {
      type: "assessment_attempted",
      title: "Assessment Attempted",
      message: `${student.name || "A student"} attempted "${assessment.assessmentName}" and scored ${parseFloat(percentage.toFixed(2))}%`,
      data: {
        studentId: studentId,
        studentName: student.name,
        assessmentId: assessmentId,
        assessmentName: assessment.assessmentName,
        score: score,
        totalMarks: totalMarks,
        percentage: parseFloat(percentage.toFixed(2)),
        timeTaken: timeTaken,
        submittedAt: new Date()
      },
      relatedUserId: studentId,
      relatedAssessmentId: assessmentId,
      relatedSubmissionId: submission._id
    });
  }

  res.status(201).json({
    message: "Assessment submitted successfully",
    score: submission.score,
    totalMarks: submission.totalMarks,
    percentage: submission.percentage,
    timeTaken: submission.timeTaken,
    submittedAt: submission.createdAt,
    submissionId: submission._id
  });
});


// @desc    Get all submissions for an assessment (Teacher view)
// @route   GET /api/assessments/:id/submissions
// @access  Private (Teacher)
const getAssessmentSubmissions = asyncHandler(async (req, res) => {
  const assessment = await AssessmentUpload.findById(req.params.id);
  
  if (!assessment) {
    res.status(404);
    throw new Error('Assessment not found');
  }

  // Verify teacher owns this assessment
  if (assessment.teacherId.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized to view these submissions');
  }

  const submissions = await AssessmentSubmission.find({
    assessmentId: req.params.id
  }).populate('studentId', 'name email');

  res.json({
    assessment: {
      _id: assessment._id,
      assessmentName: assessment.assessmentName,
      totalQuestions: assessment.questions.length,
      totalMarks: assessment.questions.reduce((sum, q) => sum + (q.marks || 1), 0)
    },
    submissions
  });
});
// Get total count of assessments in the library
const getAssessmentLibraryCount = async (req, res) => {
  try {
    const count = await AssessmentUpload.countDocuments({ teacherId: req.user._id });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: "Error fetching assessment library count" });
  }
};


// Get count of assessments uploaded by the logged-in teacher
const getUploadedAssessmentsCount = async (req, res) => {
  try {
    const count = await AssessmentUpload.countDocuments({ teacherId: req.user._id });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: "Error fetching uploaded assessments count" });
  }
};

// Get count of new assessments added this week
const getNewThisWeekCount = async (req, res) => {
  try {
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Sunday
    startOfWeek.setHours(0, 0, 0, 0);

    const count = await AssessmentUpload.countDocuments({
      createdAt: { $gte: startOfWeek }
    });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: "Error fetching new this week count" });
  }
};

// @desc    Get progress for logged-in student
// @route   GET /api/assessments/progress
// @access  Private (Student)
const getStudentProgress = asyncHandler(async (req, res) => {
  if (req.user.role !== "student") {
    res.status(403);
    throw new Error("Only students can access their progress");
  }

  const submissions = await AssessmentSubmission.find({ studentId: req.user._id })
    .populate("assessmentId", "assessmentName createdAt")
    .sort({ submittedAt: -1 });

  const progressData = submissions.map((s) => ({
    assessmentTitle: s.assessmentId?.assessmentName || "Untitled",
    score: s.score,
    totalMarks: s.totalMarks,
    percentage: s.percentage,
    date: s.submittedAt,
  }));

  res.json(progressData);
});

// @desc    Get progress of all students for assessments uploaded by the logged-in teacher
// @route   GET /api/assessments/teacher/student-progress
// @access  Private (Teacher)
const getStudentProgressForTeacher = asyncHandler(async (req, res) => {
  if (req.user.role !== "teacher") {
    res.status(403);
    throw new Error("Only teachers can access this data");
  }

  // Step 1: Find assessments uploaded by this teacher
  const assessments = await AssessmentUpload.find({ teacherId: req.user._id }).select("_id assessmentName gradeLevel");

  const assessmentMap = {};
  const assessmentIds = assessments.map((a) => {
    assessmentMap[a._id.toString()] = {
      assessmentTitle: a.assessmentName,
      gradeLevel: a.gradeLevel,
    };
    return a._id;
  });

  // Step 2: Get all submissions for those assessments
  const submissions = await AssessmentSubmission.find({
    assessmentId: { $in: assessmentIds },
  })
    .populate("studentId", "name class")
    .sort({ submittedAt: -1 });

  // Step 3: Structure the response
const progressData = await Promise.all(
  submissions.map(async (s) => {
    // 🔑 check if feedback exists for this student + assessment
    const feedback = await Feedback.findOne({
      studentId: s.studentId?._id,
      assessmentId: s.assessmentId,
    });

    return {
      submissionId: s._id,
      studentId: s.studentId?._id,
      studentName: s.studentId?.name || "Unknown",
      studentClass: s.studentId?.class || "N/A",
      assessmentTitle:
        assessmentMap[s.assessmentId.toString()]?.assessmentTitle || "Untitled",
      score: s.score,
      totalMarks: s.totalMarks,
      percentage: s.percentage,
      date: s.submittedAt || s.createdAt,
      timeTaken: s.timeTaken || null,
      feedbackSent: !!feedback, // ✅ NEW FLAG
    };
  })
);

res.json(progressData);
});

// @desc    Get progress summary for logged-in teacher
// @route   GET /api/assessments/teacher-progress
// @access  Private (Teacher)
const getTeacherProgress = asyncHandler(async (req, res) => {
  if (req.user.role !== "teacher") {
    res.status(403);
    throw new Error("Only teachers can access this route");
  }

  const teacherId = req.user._id;

  // Fetch all assessments by this teacher
  const assessments = await AssessmentUpload.find({ teacherId });

  const assessmentIds = assessments.map(a => a._id);
  const totalAssessments = assessments.length;

  // Fetch all submissions to these assessments
  const submissions = await AssessmentSubmission.find({ assessmentId: { $in: assessmentIds } });

  const totalSubmissions = submissions.length;

  const averageScore = submissions.length > 0
    ? (submissions.reduce((sum, s) => sum + s.percentage, 0) / submissions.length).toFixed(2)
    : 0;

  res.json({
    totalAssessments,
    totalSubmissions,
    averageScore: parseFloat(averageScore),
  });
});


module.exports = {
  uploadAssessment,
  approveAssessment,
  getAssessmentForReview,
  updateAssessmentQuestions,
  getTeacherAssessments,
  deleteAssessment,
  getAllAssessments,
  getAssessmentForAttempt,
  submitAssessment,
  getAssessmentSubmissions,
   // Add these three:
  getAssessmentLibraryCount,
  getUploadedAssessmentsCount,
  getNewThisWeekCount,
  getStudentProgress,
  getStudentProgressForTeacher,
  getTeacherProgress, // ✅ ADD THIS
};