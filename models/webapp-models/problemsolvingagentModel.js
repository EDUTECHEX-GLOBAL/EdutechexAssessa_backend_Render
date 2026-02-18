const mongoose = require("mongoose");

const aiAgentSchema = new mongoose.Schema({
  prompt: { type: String, required: true },
  mode: {
    type: String,
    enum: ["ai-generated", "pre-built", "teacher-contributed"],
    required: true,
  },
  response: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("ProblemsolvingAgent", aiAgentSchema);
