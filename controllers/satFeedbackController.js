// backend/controllers/satFeedbackController.js

const asyncHandler = require("express-async-handler");
const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require("@aws-sdk/client-bedrock-runtime");

const SatFeedback = require("../models/webapp-models/satFeedbackModel");
const SatSubmission = require("../models/webapp-models/satSubmissionModel");
const SatAssessment = require("../models/webapp-models/satAssessmentModel");

// Bedrock client
const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_MODEL_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_MODEL_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_MODEL_ACCESS_KEY,
  },
});

function buildPrompt({ student, assessment, submission, questions, history }) {
  return `
You are an experienced SAT tutor.

Task: Analyse the student's SAT submission and return constructive, actionable feedback in JSON.

STUDENT:
Name: ${student?.name || "Unknown"}
Email: ${student?.email || "Unknown"}

ASSESSMENT:
Title: ${assessment?.satTitle || assessment?.title || "Untitled"}
Section: ${assessment?.sectionType || "General"}

SUBMISSION METRICS:
Score: ${submission.score ?? "N/A"} / ${submission.totalMarks ?? "N/A"}
Percentage: ${submission.percentage ?? "N/A"}%
Time Taken: ${submission.timeTaken ?? "unknown"}

QUESTION SET:
${JSON.stringify(questions, null, 2)}

PAST PERFORMANCE:
${JSON.stringify(history, null, 2)}

OUTPUT FORMAT (JSON):
{
  "overallSummary": "string",
  "topicStrengths": ["string"],
  "topicWeaknesses": ["string"],
  "nextSteps": [
    { "action": "string", "resource": "string" }
  ]
}
`;
}

/**
 * Call Bedrock and attempt to reliably extract JSON.
 * Returns an object (parsed JSON) or throws on fatal parsing error.
 */
async function callBedrock(prompt) {
  const modelId = process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-5-sonnet-20240620-v1:0";

  const command = new InvokeModelCommand({
    modelId,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2048,
      temperature: 0.4,
      top_p: 0.9,
    }),
  });

  const res = await bedrock.send(command);
  const raw = new TextDecoder().decode(res.body);

  // Attempt a few robust parsing strategies
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // If Bedrock doesn't return JSON directly, return wrapped text
    // Throw with raw payload so you can debug in logs
    throw new Error("Bedrock returned invalid JSON: " + raw.slice(0, 1000));
  }

  // 1) If structured like { content: [ { text: "..." } ] }
  const textSeed = parsed?.content?.[0]?.text;
  if (textSeed) {
    try {
      return JSON.parse(textSeed);
    } catch (err) {
      // textSeed might be plain text — wrap into object
      return { overallSummary: String(textSeed) };
    }
  }

  // 2) If parsed itself already looks like expected JSON
  if (parsed.overallSummary || parsed.topicStrengths || parsed.topicWeaknesses || parsed.nextSteps) {
    return parsed;
  }

  // 3) Try to find first string value in parsed that contains JSON-looking substring
  for (const key of Object.keys(parsed)) {
    const v = parsed[key];
    if (typeof v === "string" && v.trim().startsWith("{")) {
      try {
        return JSON.parse(v);
      } catch (err) {
        // ignore
      }
    }
  }

  // Fallback - return raw content as overallSummary
  return { overallSummary: JSON.stringify(parsed).slice(0, 2000) };
}

// Generate AI feedback (does NOT save)
const generateFeedback = asyncHandler(async (req, res) => {
  const { studentId, submissionId } = req.body;

  if (!studentId || !submissionId) {
    return res.status(400).json({ message: "studentId and submissionId are required" });
  }

  const submission = await SatSubmission.findById(submissionId)
    .populate("studentId", "name email")
    .populate("assessmentId", "satTitle sectionType");

  if (!submission) {
    return res.status(404).json({ message: "SAT submission not found" });
  }

  const assessment = await SatAssessment.findById(submission.assessmentId) || submission.assessmentId;
  const questions = submission.responses ?? [];

  // Optionally fetch last 5 SAT submissions (same assessment or same student)
  const historyDocs = await SatSubmission.find({
    studentId,
    _id: { $ne: submission._id },
    // If you want section-specific history, you can filter by assessmentId or assessment.sectionType
    // assessmentId: submission.assessmentId
  })
    .sort({ submittedAt: -1 })
    .limit(5)
    .select("percentage submittedAt");

  const history = historyDocs.map((d) => ({
    date: d.submittedAt?.toISOString()?.split("T")[0] || null,
    percent: d.percentage,
  }));

  const prompt = buildPrompt({
    student: submission.studentId,
    assessment,
    submission,
    questions,
    history,
  });

  const feedbackJSON = await callBedrock(prompt);

  // Return the generated feedback (stringified for frontend compatibility)
  res.status(200).json({ feedbackText: JSON.stringify(feedbackJSON) });
});

// Save only (expects feedbackText already present - string or object)
const saveGeneratedFeedback = asyncHandler(async (req, res) => {
  const { studentId, submissionId, feedbackText } = req.body;

  if (!studentId || !submissionId || !feedbackText) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const submission = await SatSubmission.findById(submissionId);
  if (!submission) return res.status(404).json({ message: "Submission not found" });

  const assessmentId = submission.assessmentId;
  if (!assessmentId) return res.status(400).json({ message: "Associated assessment not found" });

  // Prevent duplicates per submissionId (allows same student + same assessment but different submission to have feedback)
  const existing = await SatFeedback.findOne({
    submissionId,
  });

  if (existing) {
    return res.status(409).json({ message: "Feedback already exists for this submission." });
  }

  const fbToStore = typeof feedbackText === "string" ? feedbackText : JSON.stringify(feedbackText);

  const saved = await SatFeedback.create({
    studentId,
    assessmentId,
    submissionId,
    assessmentType: "sat",
    feedbackText: fbToStore,
    createdBy: req.user?._id,
  });

  // Mark submission feedbackSent
  await SatSubmission.updateOne({ _id: submissionId }, { $set: { feedbackSent: true } });

  res.status(201).json({ message: "SAT feedback saved", feedbackId: saved._id });
});

// Generate & Save together
const generateAndSaveFeedback = asyncHandler(async (req, res) => {
  const { studentId, submissionId } = req.body;

  if (!studentId || !submissionId) {
    return res.status(400).json({ message: "studentId and submissionId are required" });
  }

  const submission = await SatSubmission.findById(submissionId)
    .populate("studentId", "name email")
    .populate("assessmentId", "satTitle sectionType");

  if (!submission) return res.status(404).json({ message: "SAT submission not found" });

  const assessment = await SatAssessment.findById(submission.assessmentId) || submission.assessmentId;
  const questions = submission.responses ?? [];

  const historyDocs = await SatSubmission.find({
    studentId,
    _id: { $ne: submission._id },
  })
    .sort({ submittedAt: -1 })
    .limit(5)
    .select("percentage submittedAt");

  const history = historyDocs.map((d) => ({
    date: d.submittedAt?.toISOString()?.split("T")[0] || null,
    percent: d.percentage,
  }));

  const prompt = buildPrompt({
    student: submission.studentId,
    assessment,
    submission,
    questions,
    history,
  });

  const feedbackJSON = await callBedrock(prompt);
  const feedbackString = JSON.stringify(feedbackJSON);

  // Prevent duplicate per submission
  const existing = await SatFeedback.findOne({ submissionId });
  if (existing) {
    return res.status(409).json({ message: "Feedback already exists for this submission." });
  }

  const saved = await SatFeedback.create({
    studentId,
    assessmentId: submission.assessmentId,
    submissionId,
    assessmentType: "sat",
    feedbackText: feedbackString,
    createdBy: req.user?._id,
  });

  await SatSubmission.updateOne({ _id: submissionId }, { $set: { feedbackSent: true } });

  res.status(201).json({
    message: "Feedback generated and saved",
    feedbackText: feedbackString,
    feedbackId: saved._id,
  });
});

// Get feedbacks for student
const getFeedbacksByStudent = asyncHandler(async (req, res) => {
  const studentId = req.user?._id;

  const feedbacks = await SatFeedback.find({ studentId, assessmentType: "sat" })
    .populate("assessmentId", "satTitle sectionType")
    .populate("submissionId", "score totalMarks percentage submittedAt")
    .sort({ createdAt: -1 });

  const parsed = feedbacks.map((fb) => {
    const submission = fb.submissionId || {};

    // If submission has percentage use it; otherwise calculate if score/totalMarks exist; else default 0
    const rawPercent =
      typeof submission.percentage === "number"
        ? submission.percentage
        : (typeof submission.score === "number" && typeof submission.totalMarks === "number" && submission.totalMarks > 0)
        ? (submission.score / submission.totalMarks) * 100
        : 0;

    const percentage = Number(rawPercent.toFixed(1)); // numeric, one decimal

    // Determine date: prefer feedback createdAt, then submission.submittedAt, fallback to now
    const dateObj = fb.createdAt || submission.submittedAt || new Date();
    const dateISO = new Date(dateObj).toISOString();

    return {
      // keep the feedback DB id so frontend keys/usage remain consistent
      _id: fb._id,
      assessmentName:
        fb.assessmentId?.satTitle ||
        fb.assessmentId?.sectionType ||
        "Untitled",
      percentage,
      // frontend expects a 'date' field (you used feedback.date). Provide ISO string.
      date: dateISO,
      // also include createdAt in case other code reads it
      createdAt: dateISO,
      // ensure feedbackText is parsed object (not JSON string)
      feedbackText: (() => {
        try {
          return JSON.parse(fb.feedbackText);
        } catch {
          return fb.feedbackText;
        }
      })(),
    };
  });

  res.json(parsed);
});

// Get all SAT feedbacks (teacher/admin)
const getAllFeedbacks = asyncHandler(async (req, res) => {
  const feedbacks = await SatFeedback.find({ assessmentType: "sat" })
    .populate("studentId", "name email")
    .populate("assessmentId", "satTitle sectionType")
    .populate("submissionId", "score totalMarks percentage submittedAt")
    .sort({ createdAt: -1 });

  const parsed = feedbacks.map((fb) => {
    const submission = fb.submissionId || {};

    // Percentage calculation
    const rawPercent =
      typeof submission.percentage === "number"
        ? submission.percentage
        : (typeof submission.score === "number" &&
           typeof submission.totalMarks === "number" &&
           submission.totalMarks > 0)
        ? (submission.score / submission.totalMarks) * 100
        : 0;

    const percentage = Number(rawPercent.toFixed(1));

    return {
      _id: fb._id,
      studentId: fb.studentId, // populated object
      assessmentId: fb.assessmentId, // populated object
      submissionId: fb.submissionId?._id,
      score: submission.score ?? null,
      total: submission.totalMarks ?? null,
      percentage,
      createdAt: fb.createdAt,
      feedbackText: (() => {
        try {
          return JSON.parse(fb.feedbackText);
        } catch {
          return fb.feedbackText;
        }
      })(),
    };
  });

  res.json(parsed);
});


module.exports = {
  generateFeedback,
  saveGeneratedFeedback,
  generateAndSaveFeedback,
  getFeedbacksByStudent,
  getAllFeedbacks,
};
