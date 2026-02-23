const express = require("express");
const dotenv = require("dotenv");
const path = require("path");
const cors = require("cors");
const connectDB = require("./config/dbConfig");
const { notFound, errorHandler } = require("./middlewares/errorMiddleware");

dotenv.config(); // Load environment variables

const app = express(); // Initialize express app

// MongoDB Connection
connectDB(); // Establish MongoDB connection

// Enable CORS for frontend-backend communication
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5000",
  "https://www.edutechexassessa.com",
  "https://edutechexassessa.com",
  "https://edutechex-assessa-frontend-vercel.vercel.app"
];

const corsOptions = {
  origin: function (origin, callback) {
    const cleanedOrigin = origin?.replace(/\/$/, ""); // Remove trailing slash

    if (!origin || allowedOrigins.includes(cleanedOrigin)) {
      callback(null, true);
    } else {
      console.warn("Blocked by CORS:", cleanedOrigin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

// ✅ Debug middleware
app.use((req, res, next) => {
  next();
});

// Middleware
app.use(express.json());

// Routes
const userRoutes = require("./routes/webapp-routes/userRoutes");
const teacherRoutes = require("./routes/teacherRoutes");
const adminRoutes = require("./routes/adminRoutes");
const forgotPasswordRoutes = require("./routes/student_forgotpassword_routes");
const teacherForgotPasswordRoutes = require("./routes/teacher_forgotpassword_routes");
const assessaRoute = require("./routes/assessaRoute");
const problemsolvingagentRoutes = require("./routes/problemsolvingagentRoutes");
const assessmentuploadformRoutes = require("./routes/assessmentuploadformRoutes");
const uploadProfilePicRoutes = require("./routes/uploadProfilePicRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const satFeedbackRoutes = require("./routes/satFeedbackRoutes");
const studyPlanRoutes = require("./routes/studyPlanRoutes");
const satStudyPlanRoutes = require("./routes/satStudyPlanRoutes");
const studentChatRoutes = require("./routes/chatbotroutes");
const teacherChatbotRoutes = require("./routes/teacherChatbotRoutes");
const satAssessmentRoutes = require("./routes/satAssessmentRoutes");
const generatedAssessmentCountRoutes = require("./routes/generatedAssessmentCountRoutes");
const studentAttemptedAssessmentsRoutes = require("./routes/studentAttemptedAssessmentsRoutes");
const proctoringRoutes = require("./routes/proctoringRoutes");
const adminNotificationRoutes = require("./routes/adminNotificationRoutes");
const subscriptionRoutes = require("./routes/subscriptionRoutes");
const schoolAdminRoutes = require("./routes/schoolAdminRoutes"); // ✅ Unified routes
const schoolAdminForgotPasswordRoutes = require("./routes/schoolAdmin_forgotpassword_routes");

app.use("/api/users", userRoutes);
app.use("/api/teachers", teacherRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/forgot-password", forgotPasswordRoutes);
app.use("/api/teacher/forgot-password", teacherForgotPasswordRoutes);
app.use("/api/assessa", assessaRoute);
app.use("/api/contact", assessaRoute);
app.use("/api/ai-agent", problemsolvingagentRoutes);
app.use("/api/assessments", assessmentuploadformRoutes);
app.use("/api/upload", uploadProfilePicRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/sat-feedback", satFeedbackRoutes);
app.use("/api/study-plan", studyPlanRoutes);
app.use("/api/sat-studyplan", satStudyPlanRoutes);
app.use("/api/chat", studentChatRoutes);
app.use("/api/chat", teacherChatbotRoutes);
app.use("/api/sat-assessments", satAssessmentRoutes);
app.use("/api/generated-assessments", generatedAssessmentCountRoutes);
app.use("/api/attempts", studentAttemptedAssessmentsRoutes);
app.use("/api/proctoring", proctoringRoutes);
app.use("/api/admin/notifications", adminNotificationRoutes);
app.use("/api/subscription", subscriptionRoutes);

// ✅ ONLY THESE TWO SCHOOL ADMIN ROUTES
app.use("/api/school-admin", schoolAdminRoutes);
app.use("/api/school-admin/forgot-password", schoolAdminForgotPasswordRoutes);

// Serve static assets only in production
if (process.env.NODE_ENV === "production") {
  const __dirname = path.resolve();
  app.use(express.static(path.join(__dirname, "/client/build")));

  app.get("*", (req, res) => {
    res.sendFile(path.resolve(__dirname, "client", "build", "index.html"));
  });
} else {
  app.get("/", (req, res) => {
    res.send("API is running...");
  });
}

// Error Handling Middleware
app.use(notFound);
app.use(errorHandler);

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});