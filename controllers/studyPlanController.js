const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const AssessmentSubmission = require("../models/webapp-models/assessmentSubmissionModel");
const AssessmentUpload = require("../models/webapp-models/assessmentuploadformModel");
const Feedback = require("../models/webapp-models/FeedbackModel");
const StudyPlan = require("../models/webapp-models/studyplanModel");
const Userwebapp = require("../models/webapp-models/userModel");

const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require("@aws-sdk/client-bedrock-runtime");

// AWS Claude client (Bedrock)
const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_MODEL_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_MODEL_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_MODEL_ACCESS_KEY,
  },
});

const buildClaudePrompt = (topic, questions) => `
You are a high school teacher helping students review concepts they struggle with.

Given these incorrectly answered questions under a general topic "${topic}", determine:

1. The specific sub-topic or concept these questions are really testing
2. A short learning suggestion for that concept

Format your response strictly as JSON like this:

{
  "detectedTopic": "Narrative Perspective",
  "advice": "You should review how narrative perspective affects tone and reader understanding..."
}

Questions:
${questions.map((q, i) => `Q${i + 1}: ${q}`).join("\n")}
`;

const getCurrentWeek = () => {
  const now = new Date();
  const start = new Date(now.setDate(now.getDate() - now.getDay()));
  const end = new Date(now.setDate(now.getDate() + 6));
  return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
};

const getAITip = (feedbacks) => {
  if (!feedbacks?.length) return "Start with your most frequently missed topics";
  try {
    const feedbackText = typeof feedbacks[0].feedbackText === "string"
      ? JSON.parse(feedbacks[0].feedbackText)
      : feedbacks[0].feedbackText;

    if (feedbackText?.topicWeaknesses?.length) {
      return `Focus on ${feedbackText.topicWeaknesses[0]} first`;
    }
  } catch (e) {
    console.error("Error parsing feedback:", e);
  }
  return "Review your recent feedback for improvement areas";
};

const validateStudent = async (studentId) => {
  if (!mongoose.Types.ObjectId.isValid(studentId)) {
    throw new Error("Invalid student ID format");
  }
  const student = await Userwebapp.findById(studentId);
  if (!student) {
    throw new Error("Student not found");
  }
  return student;
};

/**
 * Uses Claude via Bedrock to validate the student's explanation.
 * Returns { isValid: boolean, feedback: string }
 */
const validateStudentSummary = async (text, question) => {
  // Prepare the Claude prompt
  const prompt = `
You are a high school teacher validating a student's explanation for a given question.

Question: ${question}

Student's Explanation: ${text}

Analyze the explanation and determine whether it correctly answers the question.
Reply strictly in this JSON format:

{
  "isValid": true,
  "feedback": "Explanation is correct and clear"
}

If the explanation is incorrect or off-topic:

{
  "isValid": false,
  "feedback": "Explanation doesn't match the question"
}
`;

  // Create Bedrock Claude model request
  const command = new InvokeModelCommand({
    modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      temperature: 0.4,
    }),
  });

  try {
    // Send request to Bedrock
    const response = await bedrock.send(command);
    const raw = new TextDecoder().decode(response.body);
    const parsed = JSON.parse(raw);
    const content = parsed?.content?.[0]?.text || "{}";

    const result = JSON.parse(content);

    // Return formatted response
    return {
      isValid: !!result.isValid,
      feedback: result.feedback || (result.isValid
        ? "Explanation accepted."
        : "Explanation doesn't match the question"),
    };
  } catch (err) {
    console.error("Claude validation error:", err);
    return {
      isValid: false,
      feedback: "AI validation failed. Please try again.",
    };
  }
};

const getPriorityIcon = ({ completion, marksLost, accuracy }) => {
  if (completion >= 80 || accuracy >= 80) return "✅";       // Good performance
  if (completion < 50 || accuracy < 60) return "⚠️";         // Needs some attention
  if (completion === 0 && marksLost > 20) return "❗";       // Critical
  return "📘";                                               // Default
};



const getStudyPlan = asyncHandler(async (req, res) => {
  try {
    const { studentId } = req.params;
    await validateStudent(studentId);

    const completedTasks = await StudyPlan.find({
      studentId,
      isCompleted: true
    }).lean();

    const completedTaskMap = completedTasks.reduce((map, task) => {
      map[task.taskId] = true;
      return map;
    }, {});
    

    const wrongAnswers = await AssessmentSubmission.aggregate([
      { $match: { studentId: new mongoose.Types.ObjectId(studentId) } },
      { $unwind: "$responses" },
      { $match: { "responses.isCorrect": false } },
      {
        $lookup: {
          from: "assessmentuploads",
          localField: "assessmentId",
          foreignField: "_id",
          as: "assessment"
        }
      },
      {
        $project: {
          questionText: "$responses.questionText",
          studentAnswer: "$responses.studentAnswer",
          correctAnswer: "$responses.correctAnswer",
          topic: "$responses.topic",
          subject: { $arrayElemAt: ["$assessment.subject", 0] },
          marksLost: "$responses.marks",
          date: "$submittedAt",
          assessmentId: 1
        }
      }
    ]);

    const feedbacks = await Feedback.find({ studentId })
      .sort({ createdAt: -1 })
      .limit(3);

    const studyPlan = {
      week: getCurrentWeek(),
      subjects: [],
      focusAreas: [],
      aiTip: getAITip(feedbacks),
      totalCompleted: completedTasks.length
    };

    const subjectMap = {};

    wrongAnswers.forEach(answer => {
      const subject = answer.subject || "General";
      const topic = answer.topic || "Mixed Concepts";

      if (!subjectMap[subject]) {
        subjectMap[subject] = { subject, topics: {} };
      }

      if (!subjectMap[subject].topics[topic]) {
        subjectMap[subject].topics[topic] = {
          topic,
          questions: [],
          totalWrong: 0,
          marksLost: 0
        };
      }

      subjectMap[subject].topics[topic].questions.push(answer);
      subjectMap[subject].topics[topic].totalWrong++;
      subjectMap[subject].topics[topic].marksLost += answer.marksLost || 0;
    });

    for (const subjectKey of Object.keys(subjectMap)) {
      const subject = subjectMap[subjectKey];
      const subjectData = {
        subject: subject.subject,
        totalMinutes: 0,
        completedMinutes: 0,
        goal: `Improve ${subject.subject} accuracy to 80%`,
        topics: []
      };

      for (const topicKey of Object.keys(subject.topics)) {
        const topic = subject.topics[topicKey];
        let accuracy = 0;

        try {
          const accuracyData = await AssessmentSubmission.aggregate([
            { $match: { studentId: new mongoose.Types.ObjectId(studentId) } },
            { $unwind: "$responses" },
            { $match: { "responses.topic": topic.topic } },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                correct: { $sum: { $cond: ["$responses.isCorrect", 1, 0] } }
              }
            }
          ]);

          if (accuracyData.length > 0) {
            accuracy = Math.round((accuracyData[0].correct / accuracyData[0].total) * 100);
          }
        } catch (err) {
          console.error(`Error calculating accuracy for ${topic.topic}:`, err);
        }

        const wrongQuestionTexts = topic.questions.slice(0, 3).map(q => q.questionText);
        let detectedTopic = topic.topic;
        let aiAdvice = `Review core concepts (current accuracy: ${accuracy}%)`;

        try {
          const prompt = buildClaudePrompt(topic.topic, wrongQuestionTexts);
          const bedrockRes = await bedrock.send(new InvokeModelCommand({
            modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify({
              anthropic_version: "bedrock-2023-05-31",
              messages: [{ role: "user", content: prompt }],
              max_tokens: 300,
              temperature: 0.6,
              top_p: 0.9
            })
          }));

          const raw = new TextDecoder().decode(bedrockRes.body);
          const parsed = JSON.parse(raw);
          const contentText = parsed.content?.[0]?.text || "{}";
          const aiJson = JSON.parse(contentText);
          detectedTopic = aiJson.detectedTopic || detectedTopic;
          aiAdvice = aiJson.advice || aiAdvice;
        } catch (err) {
          console.warn("Claude error:", err.message);
        }

        const taskIdBase = `${subject.subject}-${detectedTopic}`.replace(/\s+/g, '-').toLowerCase();

        const tasks = [
  {
    id: `${taskIdBase}-concept`,
    taskId: `${taskIdBase}-concept`, // ✅ Include taskId
    type: "concept",
    title: `Understand ${detectedTopic}`,
    description: aiAdvice,
    duration: 20,
    priority: accuracy < 50,
    isCompleted: completedTaskMap[`${taskIdBase}-concept`] || false
  },
  ...topic.questions.slice(0, 3).map((q, i) => {
    const questionTaskId = `${taskIdBase}-question-${i}`;
    return {
      id: questionTaskId,
      taskId: questionTaskId, // ✅ Include taskId
      type: "remediation",
      title: `Review question: ${q.questionText.substring(0, 30)}...`,
      description: `Your answer: ${q.studentAnswer} | Correct: ${q.correctAnswer}`,
      questionText: q.questionText,
      studentAnswer: q.studentAnswer,
      correctAnswer: q.correctAnswer,
      marksLost: q.marksLost,
      duration: 15,
      priority: true,
      isCompleted: completedTaskMap[questionTaskId] || false
    };
  }),
  {
    id: `${taskIdBase}-practice`,
    taskId: `${taskIdBase}-practice`, // ✅ Include taskId
    type: "practice",
    title: `Practice ${detectedTopic}`,
    description: "Complete 3 new questions",
    duration: 25,
    isCompleted: completedTaskMap[`${taskIdBase}-practice`] || false
  }
];


        const completedTopicTasks = tasks.filter(t => t.isCompleted);
        subjectData.completedMinutes += completedTopicTasks.reduce((sum, t) => sum + t.duration, 0);
        subjectData.totalMinutes += tasks.reduce((sum, t) => sum + t.duration, 0);

        subjectData.topics.push({
          name: detectedTopic,
          accuracy,
          wrongCount: topic.totalWrong,
          marksLost: topic.marksLost,
          tasks
        });
      }

      studyPlan.subjects.push(subjectData);

      subjectData.topics.forEach(topic => {
  const completedCount = topic.tasks.filter(t => t.isCompleted).length;
  const completion = Math.round((completedCount / topic.tasks.length) * 100) || 0;

  studyPlan.focusAreas.push({
    subject: subject.subject,
    topic: topic.name,
    accuracy: topic.accuracy,
    wrongCount: topic.wrongCount,
    marksLost: topic.marksLost,
    completion,
    icon: getPriorityIcon({
      completion,
      marksLost: topic.marksLost,
      accuracy: topic.accuracy
    }) // ✅ Assign meaningful icon based on data
  });
});

    }

    studyPlan.subjects.sort((a, b) => {
      const aMinAccuracy = Math.min(...a.topics.map(t => t.accuracy));
      const bMinAccuracy = Math.min(...b.topics.map(t => t.accuracy));
      return aMinAccuracy - bMinAccuracy;
    });

    studyPlan.focusAreas.sort((a, b) => b.marksLost - a.marksLost);

    res.status(200).json(studyPlan);
  } catch (err) {
    console.error("Study Plan Generation Error:", err);
    res.status(500).json({ error: "Failed to generate study plan", details: err.message });
  }
});

const getPracticeQuestions = asyncHandler(async (req, res) => {
  try {
    const { topic } = req.params;
    const { exclude } = req.query;

    const excludeIds = exclude
      ? exclude.split(',').filter(id => mongoose.Types.ObjectId.isValid(id))
      : [];

    const questions = await AssessmentUpload.aggregate([
      { $unwind: "$questions" },
      {
        $match: {
          "questions.topic": topic,
          "questions._id": {
            $nin: excludeIds.map(id => new mongoose.Types.ObjectId(id))
          }
        }
      },
      { $sample: { size: 5 } },
      {
        $project: {
          _id: "$questions._id",
          questionText: "$questions.questionText",
          options: "$questions.options",
          topic: "$questions.topic",
          correctAnswer: "$questions.correctAnswer"
        }
      }
    ]);

    res.status(200).json(questions);
  } catch (err) {
    console.error("Practice Questions Error:", err);
    res.status(500).json({ error: "Failed to fetch practice questions" });
  }
});

const updateStudyTask = asyncHandler(async (req, res) => {
  try {
    const { taskId } = req.params;
    const { isCompleted, notes } = req.body;
    const studentId = req.user._id;

    const task = await StudyPlan.findOneAndUpdate(
      { taskId, studentId },
      {
        $set: {
          isCompleted,
          notes,
          ...(isCompleted && { completedAt: new Date() })
        }
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    res.json({
      success: true,
      message: "Task status updated",
      taskId: task.taskId,
      isCompleted: task.isCompleted,
      updatedAt: task.updatedAt
    });
  } catch (err) {
    console.error("Update Task Error:", err);
    res.status(500).json({ error: "Failed to update task status" });
  }
});

const getStudyProgress = asyncHandler(async (req, res) => {
  try {
    const { studentId } = req.params;

    const tasks = await StudyPlan.find({ studentId });

    const assessments = await AssessmentSubmission.find({ studentId })
      .sort({ submittedAt: -1 })
      .limit(10);

    const progressData = {
      totalTasks: tasks.length,
      completedTasks: tasks.filter(t => t.isCompleted).length,
      accuracyTrend: assessments.map(a => ({
        date: a.submittedAt,
        accuracy: a.percentage
      })),
      focusAreas: await StudyPlan.aggregate([
        { $match: { studentId: new mongoose.Types.ObjectId(studentId) } },
        {
          $group: {
            _id: "$topic",
            totalTasks: { $sum: 1 },
            completedTasks: { $sum: { $cond: ["$isCompleted", 1, 0] } },
            lastCompleted: { $max: "$completedAt" }
          }
        },
        {
          $project: {
            topic: "$_id",
            completionRate: {
              $cond: [
                { $eq: ["$totalTasks", 0] },
                0,
                {
                  $round: [
                    { $multiply: [{ $divide: ["$completedTasks", "$totalTasks"] }, 100] },
                    0
                  ]
                }
              ]
            },
            lastCompleted: 1,
            _id: 0
          }
        },
        { $sort: { completionRate: 1 } },
        { $limit: 3 }
      ])
    };

    res.json(progressData);
  } catch (err) {
    console.error("Study Progress Error:", err);
    res.status(500).json({ error: "Failed to get study progress" });
  }
});


// Add the new validateSummary function (same implementation as before)
const validateSummary = asyncHandler(async (req, res) => {
  try {
    const { text, question } = req.body;
    
    // Basic validation
    if (!text || !question) {
      return res.status(400).json({ 
        error: "Both text and question are required" 
      });
    }

    if (text.length < 20) {
      return res.json({ 
        isValid: false, 
        feedback: "Explanation too short (min 20 characters)" 
      });
    }

    const validation = await validateStudentSummary(text, question);
    res.json(validation);
  } catch (err) {
    console.error("Summary validation failed:", err);
    res.status(500).json({ 
      error: "Summary validation failed",
      isValid: false,
      feedback: "Please try again later"
    });
  }
});

module.exports = {
  getStudyPlan,
  getPracticeQuestions,
  updateStudyTask,
  getStudyProgress,
  validateSummary  // Added the new function here
};
