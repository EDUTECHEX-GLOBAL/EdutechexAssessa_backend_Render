const AssessmentUpload = require("../models/webapp-models/assessmentuploadformModel");
const SatAssessment = require("../models/webapp-models/satAssessmentModel");
const AssessmentSubmission = require("../models/webapp-models/assessmentSubmissionModel");

/**
 * @desc   Get total assessments generated (Standard + SAT)
 * @route  GET /api/generated-assessments/count
 */
const getGeneratedAssessmentCount = async (req, res) => {
  try {
    const standardCount = await AssessmentUpload.countDocuments();
    const satCount = await SatAssessment.countDocuments();

    res.json({
      standard: standardCount,
      sat: satCount,
      total: standardCount + satCount,
    });
  } catch (error) {
    console.error("❌ Error fetching generated assessments count:", error);
    res.status(500).json({ message: "Failed to fetch generated assessments count" });
  }
};

/**
 * @desc   Get all Standard Assessments with teacher & stats
 * @route  GET /api/generated-assessments/standard
 */
const getStandardAssessments = async (req, res) => {
  try {
    const assessments = await AssessmentUpload.find()
      .populate("teacherId", "name email role status");

    const enriched = await Promise.all(
      assessments.map(async (a) => {
        const submissions = await AssessmentSubmission.find({ assessmentId: a._id });
        const attempts = submissions.length;

        let avgScore = 0;
        if (attempts > 0) {
          const totalScore = submissions.reduce((sum, s) => sum + (s.percentage || 0), 0);
          avgScore = Number((totalScore / attempts).toFixed(2));
        }

        return {
          _id: a._id,
          assessmentName: a.assessmentName,
          subject: a.subject,
          gradeLevel: a.gradeLevel,
          difficulty: a.difficulty,
          questionsCount: Array.isArray(a.questions) ? a.questions.length : 0,
          createdAt: a.createdAt,

          teacher: a.teacherId
            ? { name: a.teacherId.name, email: a.teacherId.email }
            : { name: "Unknown", email: "N/A" },

          stats: { attempts, avgScore },

          // optional fields (safe fallbacks)
          status: a.status || "draft",
          tags: a.tags || [],
          estimatedTime: a.estimatedTime || null,
          rating: typeof a.rating === "number" ? a.rating : 0,
        };
      })
    );

    res.json(enriched);
  } catch (error) {
    console.error("❌ Error fetching standard assessments:", error);
    res.status(500).json({ message: "Failed to fetch standard assessments" });
  }
};

/**
 * @desc   Get all SAT Assessments with teacher info
 * @route  GET /api/generated-assessments/sat
 */
const getSatAssessments = async (req, res) => {
  try {
    const assessments = await SatAssessment.find()
      .populate("teacherId", "name email role status");

    const enriched = assessments.map((a) => ({
      _id: a._id,
      satTitle: a.satTitle,
      sectionType: a.sectionType,
      difficulty: a.difficulty,
      questionsCount: Array.isArray(a.questions) ? a.questions.length : 0,
      createdAt: a.createdAt,

      teacher: a.teacherId
        ? { name: a.teacherId.name, email: a.teacherId.email }
        : { name: "Unknown", email: "N/A" },

      stats: {
        attempts: 0, // 🚨 TODO: add SAT submissions when model exists
        avgScore: 0,
      },

      // optional safe fields
      status: a.status || "draft",
      tags: a.tags || [],
      estimatedTime: a.estimatedTime || null,
      rating: typeof a.rating === "number" ? a.rating : 0,
    }));

    res.json(enriched);
  } catch (error) {
    console.error("❌ Error fetching SAT assessments:", error);
    res.status(500).json({ message: "Failed to fetch SAT assessments" });
  }
};

/**
 * @desc   Get single SAT Assessment by ID
 * @route  GET /api/generated-assessments/sat/:id
 */
const getSatAssessmentById = async (req, res) => {
  try {
    const assessment = await SatAssessment.findById(req.params.id)
      .populate("teacherId", "name email role status");

    if (!assessment) {
      return res.status(404).json({ message: "SAT assessment not found" });
    }

    res.json({
      _id: assessment._id,
      satTitle: assessment.satTitle,
      sectionType: assessment.sectionType,
      difficulty: assessment.difficulty,
      questions: assessment.questions || [],
      questionsCount: Array.isArray(assessment.questions) ? assessment.questions.length : 0,
      createdAt: assessment.createdAt,
      teacher: assessment.teacherId
        ? { name: assessment.teacherId.name, email: assessment.teacherId.email }
        : { name: "Unknown", email: "N/A" },
      tags: assessment.tags || [],
      estimatedTime: assessment.estimatedTime || null,
    });
  } catch (error) {
    console.error("❌ Error fetching SAT assessment:", error);
    res.status(500).json({ message: "Failed to fetch SAT assessment" });
  }
};

/**
 * @desc   Get single Standard Assessment by ID
 * @route  GET /api/generated-assessments/standard/:id
 */
const getStandardAssessmentById = async (req, res) => {
  try {
    const assessment = await AssessmentUpload.findById(req.params.id)
      .populate("teacherId", "name email role status");

    if (!assessment) {
      return res.status(404).json({ message: "Standard assessment not found" });
    }

    res.json({
      _id: assessment._id,
      assessmentName: assessment.assessmentName,
      subject: assessment.subject,
      gradeLevel: assessment.gradeLevel,
      difficulty: assessment.difficulty,
      questions: assessment.questions || [],
      questionsCount: Array.isArray(assessment.questions) ? assessment.questions.length : 0,
      createdAt: assessment.createdAt,
      teacher: assessment.teacherId
        ? { name: assessment.teacherId.name, email: assessment.teacherId.email }
        : { name: "Unknown", email: "N/A" },
      tags: assessment.tags || [],
      estimatedTime: assessment.estimatedTime || null,
    });
  } catch (error) {
    console.error("❌ Error fetching standard assessment:", error);
    res.status(500).json({ message: "Failed to fetch standard assessment" });
  }
};

module.exports = {
  getGeneratedAssessmentCount,
  getStandardAssessments,
  getSatAssessments,
  getSatAssessmentById,
  getStandardAssessmentById
};
