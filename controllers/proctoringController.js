const asyncHandler = require("express-async-handler");
const ProctoringSession = require("../models/webapp-models/proctoringSessionModel");
const AssessmentUpload = require("../models/webapp-models/assessmentuploadformModel");
const SatAssessment = require("../models/webapp-models/satAssessmentModel");
const AssessmentSubmission = require("../models/webapp-models/assessmentSubmissionModel");
const SatSubmission = require("../models/webapp-models/satSubmissionModel");

// @desc    Start a proctoring session (for both test and real modes)
// @route   POST /api/proctoring/start-session
// @access  Private (Student)
const startProctoringSession = asyncHandler(async (req, res) => {
  const { assessmentId, assessmentType, mode } = req.body; // mode: 'test' or 'real'
  const studentId = req.user._id;

  if (!['test', 'real'].includes(mode)) {
    res.status(400);
    throw new Error('Mode must be either "test" or "real"');
  }

  if (!['standard', 'sat'].includes(assessmentType)) {
    res.status(400);
    throw new Error('Assessment type must be either "standard" or "sat"');
  }

  // Validate assessment exists and is approved
  let assessment;
  if (assessmentType === 'sat') {
    assessment = await SatAssessment.findOne({ _id: assessmentId, isApproved: true });
  } else {
    assessment = await AssessmentUpload.findOne({ _id: assessmentId, isApproved: true });
  }

  if (!assessment) {
    res.status(404);
    throw new Error('Assessment not found or not approved');
  }

  // Check if student already submitted this assessment
  let existingSubmission;
  if (assessmentType === 'sat') {
    existingSubmission = await SatSubmission.findOne({ assessmentId, studentId });
  } else {
    existingSubmission = await AssessmentSubmission.findOne({ assessmentId, studentId });
  }

  if (existingSubmission) {
    res.status(400);
    throw new Error('You have already submitted this assessment');
  }

  // Check if student already has an active session
  const existingSession = await ProctoringSession.findOne({
    studentId,
    assessmentId,
    status: 'active'
  });

  if (existingSession) {
    res.status(400);
    throw new Error('You already have an active session for this assessment');
  }

  // Create proctoring session
  const session = await ProctoringSession.create({
    studentId,
    assessmentId,
    assessmentType,
    mode,
    startTime: new Date(),
    status: 'active',
    violations: []
  });

  res.status(201).json({
    message: `Proctoring session started in ${mode} mode`,
    sessionId: session._id,
    mode: session.mode,
    assessmentType: session.assessmentType,
    assessmentName: assessment.assessmentName || assessment.satTitle,
    timeLimit: assessment.timeLimit || 30
  });
});

// @desc    Log proctoring violation (for real mode only)
// @route   POST /api/proctoring/log-violation
// @access  Private (Student)
const logProctoringViolation = asyncHandler(async (req, res) => {
  const { sessionId, violationType, details } = req.body;
  const studentId = req.user._id;

  const session = await ProctoringSession.findOne({
    _id: sessionId,
    studentId,
    status: 'active'
  });

  if (!session) {
    res.status(404);
    throw new Error('Active session not found');
  }

  // Only log violations for real mode
  if (session.mode !== 'real') {
    res.status(400);
    throw new Error('Violations can only be logged in real mode');
  }

  const violation = {
    type: violationType,
    timestamp: new Date(),
    details: details || {}
  };

  session.violations.push(violation);
  session.violationCount = (session.violationCount || 0) + 1;

  await session.save();

  res.json({ 
    message: 'Violation logged', 
    violationCount: session.violationCount,
    sessionId: session._id
  });
});

const endProctoringSession = asyncHandler(async (req, res) => {
  const { sessionId, submissionId } = req.body; // Keep submissionId parameter
  const studentId = req.user._id;

  const session = await ProctoringSession.findOne({
    _id: sessionId,
    studentId
  });

  if (!session) {
    res.status(404);
    throw new Error('Session not found');
  }

  // Use the provided submissionId if available, otherwise find it
  let submission;
  if (submissionId) {
    // Use the provided submissionId
    if (session.assessmentType === 'sat') {
      submission = await SatSubmission.findOne({ _id: submissionId, studentId });
    } else {
      submission = await AssessmentSubmission.findOne({ _id: submissionId, studentId });
    }
  } else {
    // Fallback: find the most recent submission
    if (session.assessmentType === 'sat') {
      submission = await SatSubmission.findOne({ 
        assessmentId: session.assessmentId, 
        studentId: studentId 
      }).sort({ createdAt: -1 });
    } else {
      submission = await AssessmentSubmission.findOne({ 
        assessmentId: session.assessmentId, 
        studentId: studentId 
      }).sort({ createdAt: -1 });
    }
  }

  if (!submission) {
    res.status(404);
    throw new Error('Submission not found');
  }

  // Link the proctoring session to the submission
  submission.proctoringSessionId = sessionId;
  submission.proctoringData = {
    mode: session.mode,
    violationCount: session.violationCount || 0,
    sessionDuration: Math.floor((new Date() - session.startTime) / 1000)
  };

  await submission.save();

  // Update session
  session.endTime = new Date();
  session.status = 'completed';
  session.linkedSubmissionId = submission._id;

  await session.save();

  res.json({ 
    message: 'Proctoring session completed',
    sessionId: session._id,
    submissionId: submission._id,
    mode: session.mode,
    violationCount: session.violationCount || 0,
    duration: Math.floor((session.endTime - session.startTime) / 1000)
  });
});

// @desc    Get proctoring sessions for teacher review
// @route   GET /api/proctoring/sessions/:assessmentId
// @access  Private (Teacher)
const getProctoringSessions = asyncHandler(async (req, res) => {
  const { assessmentId } = req.params;
  const teacherId = req.user._id;

  // Verify teacher owns this assessment
  let assessment;
  assessment = await AssessmentUpload.findOne({ _id: assessmentId, teacherId });
  
  if (!assessment) {
    assessment = await SatAssessment.findOne({ _id: assessmentId, teacherId });
  }

  if (!assessment) {
    res.status(404);
    throw new Error('Assessment not found or access denied');
  }

  const sessions = await ProctoringSession.find({ assessmentId })
    .populate('studentId', 'name email class')
    .sort({ startTime: -1 });

  res.json(sessions);
});

// @desc    Get proctoring session details for a specific submission
// @route   GET /api/proctoring/session/submission/:submissionId
// @access  Private (Teacher or Student who owns the submission)
const getProctoringSessionBySubmission = asyncHandler(async (req, res) => {
  const { submissionId } = req.params;
  const userId = req.user._id;
  const userRole = req.user.role;

  // Find submission and verify access
  let submission;
  submission = await AssessmentSubmission.findOne({ _id: submissionId })
    .populate('assessmentId');
  
  if (!submission) {
    submission = await SatSubmission.findOne({ _id: submissionId })
      .populate('assessmentId');
  }

  if (!submission) {
    res.status(404);
    throw new Error('Submission not found');
  }

  // Check access: student can only see their own, teacher can see if they own the assessment
  if (userRole === 'student' && submission.studentId.toString() !== userId.toString()) {
    res.status(403);
    throw new Error('Access denied');
  }

  if (userRole === 'teacher') {
    const assessment = submission.assessmentId;
    if (assessment.teacherId.toString() !== userId.toString()) {
      res.status(403);
      throw new Error('Access denied');
    }
  }

  // Get proctoring session
  const session = await ProctoringSession.findOne({ 
    _id: submission.proctoringSessionId 
  });

  res.json({
    submission: {
      _id: submission._id,
      score: submission.score,
      totalMarks: submission.totalMarks,
      percentage: submission.percentage
    },
    proctoringSession: session
  });
});

module.exports = {
  startProctoringSession,
  logProctoringViolation,
  endProctoringSession,
  getProctoringSessions,
  getProctoringSessionBySubmission
};