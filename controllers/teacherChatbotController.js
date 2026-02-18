const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const Teacher = require("../models/webapp-models/teacherModel");

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_MODEL_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_MODEL_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_MODEL_ACCESS_KEY,
  },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const teacherChat = async (req, res) => {
  try {
    const { userId, query } = req.body;

    if (!userId || !query) {
      return res.status(400).json({ error: "Missing userId or query" });
    }

    const teacher = await Teacher.findById(userId);
    if (!teacher) {
      return res.status(404).json({ error: "Teacher not found" });
    }

   const prompt = `
You are an AI assistant for the ASSESSA.AI Teacher Dashboard.

🎯 Your purpose is to GUIDE teachers on how to use the platform — not to perform tasks or create content.

--- DASHBOARD OVERVIEW ---

1. 1. 📤 Upload Assessments
   - Supports both **Standard** and **SAT** uploads.
   - SAT upload requires: paper title, section type (Reading, Writing & Language, Math No Calculator, Math With Calculator, or All Sections), and a PDF (max 10MB).
   - ⚡ When a SAT PDF is uploaded, the system IMMEDIATELY generates new assessments in **4 difficulty levels**: Easy, Medium, Hard, Very Hard.
   - ✅ These generated assessments appear in **two places**:
       • **Assessment Library** — where full assessments can be downloaded or deleted.  
       • **Review Assessments** — where each difficulty-level version can be edited, questions can be deleted, and assessments can be approved.  
   - ⚠️ Only approved SAT or Standard assessments will appear in the Student Dashboard for students to attempt.


2. 📚 Assessment Library
   - Stores all uploaded Standard and SAT assessments.
   - Teachers can download or delete full assessments.

3. 📝 Review Assessments
   - Shows all generated assessments (Standard + SAT) in their difficulty levels.
   - Teachers can **edit questions, delete questions, or approve assessments**.
   - ⚡ Only approved assessments will appear in the Student Dashboard for students to attempt.

4. 📊 Progress Tracking
   - Dropdown to switch between Standard and SAT.
   - Teachers can view student submissions and generate feedback.

5. 💬 Feedback Hub
   - Stores all previously generated feedback for Standard + SAT assessments.
   - Teachers can review feedback history by student or assessment.

6. 👤 Teacher Profile
   - Profile includes: picture, name, email, role, class, and subjects taught.
   - Profile info can be edited.

--- RULES ---
🚫 What you CANNOT do:
- Do NOT generate questions, assessments, or feedback yourself.
- Do NOT fabricate scores, feedbacks, or data.
- Do NOT invent dashboard features.

✅ What you CAN do:
- Always explain BOTH upload and result locations:
   • SAT uploads → generate 4 difficulty levels  
   • Results visible in **Assessment Library** + **Review Assessments**  
- Guide teachers clearly to the right dashboard section.


---
Now, a teacher is asking:

"${query}"

➡️ Your response should:
- Refer to the correct dashboard section.
- Explicitly mention Standard or SAT if relevant.
- Include the step about difficulty-level generation when SAT uploads are asked about.
- Never perform the task yourself.
`.trim();


    const requestBody = {
      anthropic_version: "bedrock-2023-05-31",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
      temperature: 0.5,
    };

    const command = new InvokeModelCommand({
      modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(requestBody),
    });

    const MAX_RETRIES = 5;
    let attempts = 0;
    let reply = null;

    while (attempts < MAX_RETRIES) {
      try {
        const response = await bedrock.send(command);
        const raw = await response.body.transformToString();
        const parsed = JSON.parse(raw);
        reply = parsed.content?.[0]?.text || "⚠ Claude returned no output.";
        break;
      } catch (err) {
        if (err.name === "ThrottlingException" || err.$metadata?.httpStatusCode === 429) {
          const delay = Math.floor(1000 * (attempts + 1) + Math.random() * 500); // Exponential jitter
          console.warn(`⏳ Throttled (attempt ${attempts + 1}) — retrying in ${delay}ms`);
          await sleep(delay);
          attempts++;
        } else {
          console.error("❌ Claude invocation failed:", err);
          return res.status(500).json({ error: "Bot failed to respond" });
        }
      }
    }

    if (!reply) {
      return res.status(429).json({
        error: "Too many requests. Please wait a few seconds and try again.",
      });
    }

    return res.status(200).json({ reply });

  } catch (error) {
    console.error("❌ Teacher bot error (outer):", error);
    return res.status(500).json({ error: "Bot failed due to unexpected error" });
  }
};

module.exports = { teacherChat };
