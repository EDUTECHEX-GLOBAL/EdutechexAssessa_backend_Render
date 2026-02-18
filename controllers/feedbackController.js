const asyncHandler = require("express-async-handler");
const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require("@aws-sdk/client-bedrock-runtime");

const AssessmentSubmission = require("../models/webapp-models/assessmentSubmissionModel");
const AssessmentUpload = require("../models/webapp-models/assessmentuploadformModel");
const Feedback = require("../models/webapp-models/FeedbackModel");

// AWS Bedrock Client Setup
const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_MODEL_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_MODEL_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_MODEL_ACCESS_KEY,
  },
});

// Prompt builder
function buildPrompt({ student, assessment, submission, questions, history }) {
  const prompt = `
You are an experienced high-school teacher.

Task: Analyse the student’s latest test and return constructive, actionable feedback in JSON.

----------------
STUDENT METRICS
----------------
Name: ${student.name}
Grade: ${student.class}
Subject: ${assessment.assessmentName}
Score: ${submission.score} / ${submission.totalMarks}
Percentage: ${submission.percentage} %
Duration: ${submission.timeTaken || "unknown"}

---------------
QUESTION SET
---------------
${JSON.stringify(questions, null, 2)}

--------------------
PAST PERFORMANCE
--------------------
${JSON.stringify(history, null, 2)}

-----------------
OUTPUT FORMAT
-----------------
{
  "overallSummary": "string",
  "topicStrengths": ["string", ...],
  "topicWeaknesses": ["string", ...],
  "nextSteps": [
    { "action": "string", "resource": "string" }
  ]
}
`;

  console.log("📝 Prompt sent to Claude:\n", prompt);
  return prompt;
}

// 1️⃣ Generate + Save Feedback
exports.generateAndSaveFeedback = asyncHandler(async (req, res) => {
  const { studentId, submissionId } = req.body;

  console.log("🔍 Received Feedback Generation Request:");
  console.log("➡️ studentId:", studentId);
  console.log("➡️ submissionId:", submissionId);

  const submission = await AssessmentSubmission.findById(submissionId).populate("studentId", "name class");
  if (!submission) {
    console.error("❌ Submission not found");
    throw new Error("Submission not found");
  }

  const assessment = await AssessmentUpload.findById(submission.assessmentId);
  if (!assessment) throw new Error("Assessment not found");

  const existing = await Feedback.findOne({
    studentId,
    assessmentId: assessment._id,
  });

  if (existing) {
    return res.status(409).json({ message: "Feedback already exists for this submission." });
  }

  // ✅ Refetch the submission to ensure responses are present
  const refreshedSubmission = await AssessmentSubmission.findById(submissionId);
  const questions = refreshedSubmission.responses ?? [];

  console.log("🧠 Student Name:", submission.studentId.name);
  console.log("📊 Score:", submission.score, "/", submission.totalMarks);
  console.log("📦 Refetched responses before Claude:\n", questions);

  const historyDocs = await AssessmentSubmission.find({
    studentId,
    subject: assessment.assessmentName,
    _id: { $ne: submission._id },
  })
    .sort({ submittedAt: -1 })
    .limit(5)
    .select("percentage submittedAt");

  const history = historyDocs.map((d) => ({
    date: d.submittedAt.toISOString().split("T")[0],
    percent: d.percentage,
  }));

  const prompt = buildPrompt({
    student: submission.studentId,
    assessment,
    submission,
    questions,
    history,
  });

  const bedrockRes = await bedrock.send(
    new InvokeModelCommand({
      modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2048,
        temperature: 0.4,
        top_p: 0.9,
      }),
    })
  );

  const raw = new TextDecoder().decode(bedrockRes.body);
  console.log("🤖 Raw Claude Response:", raw);

  const parsed = JSON.parse(raw);
  const textBlock = parsed.content?.[0]?.text ?? "{}";
  const feedbackJSON = JSON.parse(textBlock);

  const saved = await Feedback.create({
    studentId,
    assessmentId: assessment._id,
    topic: assessment.assessmentName,
    score: submission.score,
    total: submission.totalMarks,
    percentage: submission.percentage,
    feedbackText: JSON.stringify(feedbackJSON),
  });

  res.status(201).json({
    message: "Feedback generated and saved",
    feedbackText: feedbackJSON,
    feedbackId: saved._id,
  });
});

// 2️⃣ Generate Only (for testing)
exports.generateFeedback = asyncHandler(async (req, res) => {
  const { studentId, submissionId } = req.body;

  const submission = await AssessmentSubmission.findById(submissionId).populate("studentId", "name class");
  if (!submission) throw new Error("Submission not found");

  const assessment = await AssessmentUpload.findById(submission.assessmentId);
  if (!assessment) throw new Error("Assessment not found");

  const refreshedSubmission = await AssessmentSubmission.findById(submissionId);
  const questions = refreshedSubmission.responses ?? [];
  console.log("📦 Test-only: Refetched responses:", questions);

  const history = [];

  const prompt = buildPrompt({ student: submission.studentId, assessment, submission, questions, history });

  const bedrockRes = await bedrock.send(
    new InvokeModelCommand({
      modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2048,
        temperature: 0.4,
        top_p: 0.9,
      }),
    })
  );

  const raw = new TextDecoder().decode(bedrockRes.body);
  const parsed = JSON.parse(raw);
  const textBlock = parsed.content?.[0]?.text ?? "{}";
  const feedbackJSON = JSON.parse(textBlock);

  res.status(200).json({ feedbackText: feedbackJSON });
});

// 3️⃣ Save Only (for 2-step flows)
exports.saveGeneratedFeedback = asyncHandler(async (req, res) => {
  const { studentId, submissionId, feedbackText } = req.body;

  const submission = await AssessmentSubmission.findById(submissionId);
  if (!submission) throw new Error("Submission not found");

  const assessment = await AssessmentUpload.findById(submission.assessmentId);
  if (!assessment) throw new Error("Assessment not found");

  const existing = await Feedback.findOne({
    studentId,
    assessmentId: assessment._id,
  });

  if (existing) {
    return res.status(409).json({ message: "Feedback already exists for this submission." });
  }

  const saved = await Feedback.create({
    studentId,
    assessmentId: assessment._id,
    topic: assessment.assessmentName,
    score: submission.score,
    total: submission.totalMarks,
    percentage: submission.percentage,
    feedbackText: JSON.stringify(feedbackText),
  });

  res.status(201).json({ message: "Feedback saved", feedbackId: saved._id });
});

// 4️⃣ Get Feedbacks for Logged-in Student
exports.getFeedbacksByStudent = asyncHandler(async (req, res) => {
  const feedbacks = await Feedback.find({ studentId: req.user._id })
    .sort({ createdAt: -1 })
    .populate("assessmentId");

  const parsed = feedbacks.map((fb) => ({
    ...fb.toObject(),
    feedbackText: JSON.parse(fb.feedbackText),
    assessmentName: fb.assessmentId?.assessmentName || "Untitled",
    date: fb.createdAt,
  }));

  res.json(parsed);
});

// 5️⃣ Get All Feedbacks (admin/teacher view)
exports.getAllFeedbacks = asyncHandler(async (_req, res) => {
  const feedbacks = await Feedback.find().populate("studentId assessmentId");

  console.log("📦 All Feedbacks:", feedbacks.length); // Add this
  console.log("🧾 Example:", feedbacks[0]); // Add this to see shape

  const parsed = feedbacks.map((fb) => ({
    ...fb.toObject(),
    feedbackText: JSON.parse(fb.feedbackText),
  }));

  res.json(parsed);
});

