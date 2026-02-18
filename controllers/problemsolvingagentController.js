const axios = require("axios");
const ProblemsolvingAgent = require("../models/webapp-models/problemsolvingagentModel");
require("dotenv").config();

const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";

const classifyPrompt = (prompt) => {
  const keywords = {
    "pre-built": ["basic", "fundamental", "standard"],
    "teacher-contributed": ["advanced", "expert", "teacher"],
  };
  for (const [mode, words] of Object.entries(keywords)) {
    if (words.some((word) => prompt.toLowerCase().includes(word))) {
      return mode;
    }
  }
  return "ai-generated";
};

const chatHandler = async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    const resp = await axios.post(
      `${FASTAPI_URL}/chat`,
      { message, history }
    );
    return res.status(200).json({ response: resp.data.response });
  } catch (err) {
    console.error("Chat error:", err.message);
    return res.status(500).json({ error: "Failed to chat." });
  }
};

const generateHandler = async (req, res) => {
  try {
    const { num_questions, curriculum, grade, subject, topic } = req.body;
    const mode = classifyPrompt(topic);
    if (mode !== "ai-generated") {
      const existing = await ProblemsolvingAgent.findOne({ prompt: topic, mode });
      if (existing) {
        return res.status(200).json({ questions: existing.response });
      }
    }

    const resp = await axios.post(
      `${FASTAPI_URL}/generate-assessment`,
      { num_questions, curriculum, grade, subject, topic }
    );
    const questions = resp.data.questions;

    if (mode === "ai-generated") {
      await new ProblemsolvingAgent({
        prompt: topic,
        mode,
        response: questions,
      }).save();
    }

    return res.status(200).json({ questions });
  } catch (err) {
    console.error("Generate error:", err.message);
    return res.status(500).json({ error: "Failed to generate assessment." });
  }
};

// ✅ UPDATED: POST /evaluate-score
const evaluateHandler = async (req, res) => {
  try {
    const { answers, correctAnswers } = req.body;
    const resp = await axios.post(
      `${FASTAPI_URL}/evaluate-score`,
      { answers, correctAnswers }
    );
    return res.status(200).json(resp.data);
  } catch (err) {
    console.error("Evaluate score error:", err.message);
    return res.status(500).json({ error: "Failed to evaluate score." });
  }
};

const getAllAssessments = async (req, res) => {
  try {
    const assessments = await ProblemsolvingAgent.find();
    return res.status(200).json(assessments);
  } catch (err) {
    console.error("Fetch assessments error:", err.message);
    return res.status(500).json({ error: "Failed to fetch assessments." });
  }
};

module.exports = {
  chatHandler,
  generateHandler,
  evaluateHandler, // now mapped to /evaluate-score logic
  getAllAssessments,
};
