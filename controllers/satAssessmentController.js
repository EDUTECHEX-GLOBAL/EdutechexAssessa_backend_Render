const SatAssessment = require("../models/webapp-models/satAssessmentModel");
const { parseSATAssessment, parseSATAssessmentCombined, generateMathQuestions } = require("../utils/satParser");
const { uploadToS3, getSignedUrl, deleteFromS3 } = require("../config/s3Upload");
const SatSubmission = require("../models/webapp-models/satSubmissionModel");
const SatFeedback = require("../models/webapp-models/satFeedbackModel");
const { generateScoreReportPDF } = require("../utils/scoreReport");
const sendEmail = require("../utils/mailer");
const Userwebapp = require("../models/webapp-models/userModel");
const Teacher = require("../models/webapp-models/teacherModel");
const { createSchoolAdminNotification } = require("./schoolAdminNotificationController");
const SATMathGenerator = require("../utils/satMathGenerator");




// Upload SAT Assessment
exports.uploadSATAssessment = async (req, res) => {
  try {
    const teacherId = req.user._id;
    const { satTitle, sectionType } = req.body;

    if (!req.file || !satTitle || !sectionType) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    console.log("📥 Uploading SAT file for:", satTitle);

    // Get teacher's school ID
    const teacher = await Teacher.findById(teacherId).select("schoolId");
    const schoolId = teacher.schoolId;

    // Determine file type
    const fileType = req.file.mimetype === 'text/markdown' || req.file.originalname.endsWith('.md') ? 'markdown' : 'pdf';

    // Upload to S3
    const { key } = await uploadToS3(req.file, "sat");
    console.log("📤 S3 Upload Key:", key);

    // Respond immediately
    res.status(202).json({
      success: true,
      message: `SAT assessment uploaded. Generating difficulty variants from ${fileType.toUpperCase()} in the background.`,
      satTitle,
      sectionType,
      fileKey: key,
      fileType,
      generationMethod: 'math-first-enabled'
    });

    // Background processing
    (async () => {
      const difficulties = ["easy", "medium", "hard", "very hard"];
      let firstAssessmentId = null;
      let generationStats = {
        totalQuestions: 0,
        mathQuestions: 0,
        verifiedMath: 0,
        difficulties: {}
      };

      for (const difficulty of difficulties) {
        console.log(`🔄 [BG] Generating ${fileType.toUpperCase()} difficulty: ${difficulty}`);
        let questions = [];
        let attempts = 0;

        while (questions.length === 0 && attempts < 3) {
          attempts++;
          try {
            if (sectionType === "all") {
              questions = await parseSATAssessmentCombined(req.file.buffer, difficulty, fileType);
            } else {
              questions = await parseSATAssessment(req.file.buffer, sectionType, difficulty, fileType);
            }
          } catch (err) {
            console.error(`❌ [BG] Error generating ${difficulty} (attempt ${attempts}):`, err.message);
          }
        }

        if (!questions || questions.length === 0) {
          console.error(`❌ [BG] Skipping ${difficulty} — no valid questions generated`);
          continue;
        }

        // Calculate verification stats
        const mathQuestions = questions.filter(q => 
          q.sectionType && q.sectionType.includes('math') || 
          (!q.sectionType && sectionType.includes('math'))
        );
        const verifiedMath = mathQuestions.filter(q => q.verified === true).length;
        
        generationStats.difficulties[difficulty] = {
          total: questions.length,
          math: mathQuestions.length,
          verified: verifiedMath
        };
        generationStats.totalQuestions += questions.length;
        generationStats.mathQuestions += mathQuestions.length;
        generationStats.verifiedMath += verifiedMath;

        try {
          const assessment = new SatAssessment({
            teacherId,
            schoolId: schoolId,
            satTitle,
            sectionType,
            difficulty,
            questions,
            fileUrl: key,
            isApproved: false,
            fileType,
            generatedBy: mathQuestions.length > 0 ? 'math-first' : 'ai-only',
            mathValidation: {
              totalMathQuestions: mathQuestions.length,
              verifiedMathQuestions: verifiedMath,
              verificationScore: mathQuestions.length > 0 
                ? Math.round((verifiedMath / mathQuestions.length) * 100)
                : 100,
              needsReview: mathQuestions.length > 0 && verifiedMath < mathQuestions.length
            }
          });

          await assessment.save();
          
          // Store first assessment ID for notification
          if (!firstAssessmentId) {
            firstAssessmentId = assessment._id;
          }
          
          console.log(`✅ [BG] Saved ${difficulty} with ${questions.length} questions ` +
                     `(${mathQuestions.length} math, ${verifiedMath} verified)`);
          
        } catch (saveErr) {
          console.error(`❌ [BG] Failed to save ${difficulty} assessment:`, saveErr.message);
        }
      }

      // Add notification for school admin
      if (schoolId && firstAssessmentId) {
        await createSchoolAdminNotification(schoolId, {
          type: "assessment_generated",
          title: "New SAT Assessment Generated",
          message: `Teacher uploaded "${satTitle}" (${sectionType}) with ${generationStats.totalQuestions} total questions`,
          data: {
            teacherId: teacherId,
            satTitle: satTitle,
            sectionType: sectionType,
            difficultyLevels: difficulties.length,
            totalQuestions: generationStats.totalQuestions,
            mathQuestions: generationStats.mathQuestions,
            verifiedMath: generationStats.verifiedMath,
            fileType: fileType,
            isSAT: true,
            generationMethod: 'math-first'
          },
          relatedUserId: teacherId,
          relatedAssessmentId: firstAssessmentId
        });
      }

      console.log(`🏁 [BG] ${fileType.toUpperCase()} generation completed:`, generationStats);
      
    })().catch(e => console.error("❌ [BG] Uncaught generation error:", e));

  } catch (err) {
    console.error("❌ SAT upload error:", err);
    if (!res.headersSent) {
      res.status(500).json({ message: "Internal server error during SAT upload." });
    }
  }
};
// Get all SAT assessments by logged-in teacher
exports.getMySATAssessments = async (req, res) => {
  try {
    const teacherId = req.user._id;

    const assessments = await SatAssessment.find({ teacherId }).sort({ createdAt: -1 });

    const assessmentsWithUrls = await Promise.all(
      assessments.map(async (a) => {
        const validationStatus = a.getMathValidationStatus();
        
        return {
          ...a._doc,
          signedUrl: a.fileUrl ? await getSignedUrl(a.fileUrl) : null,
          mathValidationStatus: validationStatus,
          needsReview: a.mathValidation.needsReview || a.status === 'needs_review'
        };
      })
    );

    res.json(assessmentsWithUrls);
  } catch (error) {
    console.error("❌ Error fetching SAT assessments:", error);
    res.status(500).json({ message: "Failed to fetch SAT assessments" });
  }
};
// ✅ Delete SAT Assessment
exports.deleteSATAssessment = async (req, res) => {
  try {
    const assessment = await SatAssessment.findById(req.params.id);

    if (!assessment) {
      return res.status(404).json({ message: "SAT assessment not found" });
    }

    if (assessment.teacherId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized to delete this SAT assessment" });
    }

    // Delete from S3 if exists
    if (assessment.fileUrl) {
      try {
        await deleteFromS3(assessment.fileUrl);
      } catch (err) {
        console.warn("⚠️ Failed to delete file from S3:", err.message);
      }
    }

    // ✅ Also delete all related submissions
    await SatSubmission.deleteMany({ assessmentId: assessment._id });

    // Finally delete the assessment
    await assessment.deleteOne();

    res.json({ message: "SAT assessment and related submissions deleted successfully", id: req.params.id });
  } catch (err) {
    console.error("❌ Error deleting SAT assessment:", err);
    res.status(500).json({ message: "Failed to delete SAT assessment" });
  }
};

// ✅ Get SAT Assessment Count for Dashboard
exports.getSatAssessmentCount = async (req, res) => {
  try {
    const count = await SatAssessment.countDocuments({ teacherId: req.user._id });
    res.json({ count });
  } catch (error) {
    console.error("❌ Error fetching SAT assessment count:", error);
    res.status(500).json({ message: "Failed to fetch SAT assessment count" });
  }
};

// ✅ Get all SAT assessments (for students)
exports.getAllSATAssessmentsForStudents = async (req, res) => {
  try {
    // ✅ Step 1: Ensure only students can access
    if (!req.user || req.user.role !== "student") {
      return res.status(403).json({ message: "Only students can access this route." });
    }

    // ✅ Step 2: Fetch only APPROVED assessments
    const assessments = await SatAssessment.find({ isApproved: true }).sort({ createdAt: -1 });

    const studentId = req.user._id;
    const submissions = await SatSubmission.find({ studentId });

    // ✅ Step 3: Combine assessments with submission and signed S3 URL
    const assessmentsWithSubmission = await Promise.all(
      assessments.map(async (a) => {
        const submission = submissions.find(
          (s) => s.assessmentId.toString() === a._id.toString()
        );
        return {
          ...a._doc,
          submission: submission
            ? {
                score: submission.score,
                totalMarks: submission.totalMarks,
                percentage: submission.percentage,
              }
            : null,
          signedUrl: a.fileUrl ? await getSignedUrl(a.fileUrl) : null,
        };
      })
    );

    res.json(assessmentsWithSubmission);
  } catch (err) {
    console.error("❌ Error fetching SAT assessments for students:", err);
    if (!res.headersSent) {
      res.status(500).json({ message: "Failed to fetch SAT assessments" });
    }
  }
};


// ✅ Get one SAT assessment for attempt (no restrictions on correct answer)
exports.getSatAssessmentForAttempt = async (req, res) => {
  try {
    const satAssessment = await SatAssessment.findById(req.params.id);

    if (!satAssessment) {
      return res.status(404).json({ message: "SAT assessment not found" });
    }

    res.status(200).json({
      _id: satAssessment._id,
      satTitle: satAssessment.satTitle,
      sectionType: satAssessment.sectionType,
      timeLimit: 30, // or customize per sectionType
      questions: satAssessment.questions.map(q => ({
        questionText: q.questionText,
        passage: q.passage || null,
        options: q.options || [],
        type: q.type,
        marks: q.marks || 1,
      })),
    });
  } catch (err) {
    console.error("❌ Error fetching SAT assessment:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

// ✅ Get all submissions for a SAT assessment (Teacher view)
exports.getSatAssessmentSubmissions = async (req, res) => {
  try {
    const satAssessment = await SatAssessment.findById(req.params.id);
    if (!satAssessment) {
      return res.status(404).json({ message: "SAT assessment not found" });
    }

    // Only the teacher who created the SAT assessment can view
    if (satAssessment.teacherId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized to view submissions" });
    }

    const submissions = await SatSubmission.find({
      assessmentId: req.params.id,
    }).populate("studentId", "name email");

    res.status(200).json({
      assessment: {
        _id: satAssessment._id,
        satTitle: satAssessment.satTitle,
        sectionType: satAssessment.sectionType,
        totalQuestions: satAssessment.questions.length,
        totalMarks: satAssessment.questions.reduce((sum, q) => sum + (q.marks || 1), 0),
      },
      submissions,
    });
  } catch (err) {
    console.error("❌ Error fetching SAT submissions:", err);
    res.status(500).json({ message: "Internal server error while fetching submissions" });
  }
};

// @desc    Submit answers to a SAT assessment
// @route   POST /api/sat-assessments/:id/submit
// @access  Private (Student)
exports.submitSatAssessment = async (req, res) => {
  try {
    const { answers, timeTaken, mode = "test" } = req.body;
    const studentId = req.user._id;

     // ✅ GET STUDENT'S SCHOOL ID
    const student = await Userwebapp.findById(studentId).select("schoolId");
    const schoolId = student.schoolId;

    // Validate input
    if (!Array.isArray(answers) || typeof timeTaken !== 'number' || timeTaken < 0) {
      return res.status(400).json({ 
        message: "Invalid request format" 
      });
    }

    const assessment = await SatAssessment.findById(req.params.id);
    if (!assessment) {
      return res.status(404).json({ message: "SAT assessment not found" });
    }

    // ✅ Validation for assessment questions
    const invalidQuestions = assessment.questions.filter((q, i) => {
      if (q.type === 'mcq') {
        return (
          typeof q.correctAnswer !== 'number' ||
          q.correctAnswer < 0 ||
          q.correctAnswer >= (q.options?.length || 0)
        );
      }
      return false;
    });

    if (invalidQuestions.length > 0) {
      return res.status(422).json({
        message: "Assessment contains invalid questions",
        invalidCount: invalidQuestions.length
      });
    }

    if (answers.length !== assessment.questions.length) {
      return res.status(400).json({ 
        message: `Expected ${assessment.questions.length} answers, received ${answers.length}` 
      });
    }

    let score = 0;
    const responses = [];
    const totalMarks = assessment.questions.reduce((sum, q) => sum + (q.marks || 1), 0);

    // Answer processing
    assessment.questions.forEach((question, index) => {
      const studentAnswer = answers[index];
      const questionMarks = question.marks || 1;
      let isCorrect = false;

      if (question.type === 'mcq') {
        const studentAns = parseInt(studentAnswer);
        if (!isNaN(studentAns) && studentAns >= 0 && studentAns < question.options.length) {
          isCorrect = studentAns === parseInt(question.correctAnswer);
        }
      } else {
        const normalize = (ans) => {
          if (ans === null || ans === undefined) return '';
          return String(ans)
            .trim()
            .toLowerCase()
            .replace(/[^0-9\.\/\-]/g, '')
            .replace(/^0+(\d)/, '$1')
            .replace(/(\.\d*?)0+$/, '$1')
            .replace(/\.$/, '');
        };
        isCorrect = normalize(studentAnswer) === normalize(question.correctAnswer);
      }

      if (isCorrect) score += questionMarks;

      responses.push({
        questionText: question.questionText,
        options: question.options || [],
        correctAnswer: question.correctAnswer,
        studentAnswer,
        isCorrect,
        marks: questionMarks,
        type: question.type
      });
    });

    const percentage = (score / totalMarks) * 100;

    const submission = new SatSubmission({
      studentId,
      assessmentId: assessment._id,
      schoolId: schoolId,
      responses,
      score,
      totalMarks,
      percentage: parseFloat(percentage.toFixed(2)),
      timeTaken,
      proctoringData: {
        mode: mode, // Add this line
        violationCount: 0,
        sessionDuration: timeTaken
      }
    });

    await submission.save();

    // ADD THIS AFTER submission save:
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
          "sat"
        );

        await sendEmail.sendScoreReportEmail(
          student.email,
          student.name || "Student",
          pdfBuffer,
          "sat"
        );
      } else {
        console.warn("⚠️ Student email not found; skipping SAT score report send.");
      }
    } catch (err) {
      console.error("❌ Failed to generate/send SAT score report:", err);
      // Don't throw → keep submission success even if email fails
    }

    // ✅ ADD NOTIFICATION FOR SCHOOL ADMIN
    if (schoolId) {
      const student = await Userwebapp.findById(studentId).select("name");
      
      await createSchoolAdminNotification(schoolId, {
        type: "assessment_attempted",
        title: "SAT Assessment Attempted",
        message: `${student.name || "A student"} attempted SAT "${assessment.satTitle}" and scored ${parseFloat(percentage.toFixed(2))}%`,
        data: {
          studentId: studentId,
          studentName: student.name,
          assessmentId: assessment._id,
          assessmentName: assessment.satTitle,
          sectionType: assessment.sectionType,
          score: score,
          totalMarks: totalMarks,
          percentage: parseFloat(percentage.toFixed(2)),
          timeTaken: timeTaken,
          isSAT: true,
          submittedAt: new Date()
        },
        relatedUserId: studentId,
        relatedAssessmentId: assessment._id,
        relatedSubmissionId: submission._id
      });
    }

    res.status(200).json({ 
      success: true,
      score,
      totalMarks,
      percentage: parseFloat(percentage.toFixed(2)),
      submissionId: submission._id
    });

  } catch (err) {
    console.error("SAT submission error:", err);
    res.status(500).json({ 
      message: "Failed to submit SAT assessment",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ✅ Get all SAT submissions for current student
exports.getMySatSubmissions = async (req, res) => {
  try {
    const studentId = req.user._id;
    const submissions = await SatSubmission.find({ studentId }).select("assessmentId");
    const completedAssessmentIds = submissions.map(s => s.assessmentId.toString());
    res.json({ completed: completedAssessmentIds });
  } catch (err) {
    console.error("❌ Failed to fetch student's SAT submissions:", err);
    res.status(500).json({ message: "Failed to fetch SAT submissions" });
  }
};
// @desc    Get all SAT assessments uploaded by the current teacher
// @route   GET /api/sat-assessments/teacher/all?status=pending|approved|all
// @access  Private (Teacher only)
exports.getMySATAssessmentsForReview = async (req, res) => {
  try {
    const teacherId = req.user._id;
    const { status } = req.query;

    let filter = { teacherId };

    if (status === "pending") {
      filter.isApproved = false;
      // Include assessments with status "draft" or "needs_review"
      // Jumbled assessments have status: "draft"
      filter.status = { $in: ["draft", "needs_review"] };
    } else if (status === "approved") {
      filter.isApproved = true;
      filter.status = "published";
    } else if (status === "needs_review") {
      filter['mathValidation.needsReview'] = true;
      filter.isApproved = false;
      filter.status = "needs_review";
    }
    // Note: When status === "all", we don't add any status filters

    const assessments = await SatAssessment.find(filter).sort({ createdAt: -1 });
    
    const enhancedAssessments = assessments.map(assessment => {
      const validationStatus = assessment.getMathValidationStatus();
      
      // Add jumbled assessment info
      const isJumbled = assessment.isJumbled || false;
      const sourceCount = assessment.sourceAssessments?.length || 0;
      
      return {
        ...assessment._doc,
        mathValidationStatus: validationStatus,
        hasMathIssues: assessment.mathValidation.needsReview,
        questionableMathCount: assessment.questions.filter(q => 
          q.type === 'mcq' && 
          q.options && 
          q.options.length === 4 &&
          q.questionText && 
          /[0-9+\-*/=]/.test(q.questionText) && 
          q.options[q.correctAnswer] && 
          !/\d/.test(q.options[q.correctAnswer])
        ).length,
        // Add jumbled assessment info
        isJumbled: isJumbled,
        sourceCount: sourceCount,
        assessmentType: isJumbled ? 'jumbled' : 'regular'
      };
    });
    
    res.json(enhancedAssessments);
  } catch (err) {
    console.error("Error fetching SAT assessments for review", err);
    res.status(500).json({ message: "Failed to fetch SAT assessments" });
  }
};
// @desc    Approve a specific SAT assessment
// @route   PATCH /api/sat-assessments/:id/approve
// @access  Private (Teacher only)
exports.approveSATAssessment = async (req, res) => {
  try {
    const { id } = req.params;

    const assessment = await SatAssessment.findById(id);
    if (!assessment) {
      return res.status(404).json({ message: "SAT Assessment not found" });
    }
    
    // Special handling for jumbled assessments
    const isJumbled = assessment.isJumbled || false;
    
    if (isJumbled) {
      // For jumbled assessments, all questions should already be verified
      // We can skip some validations since they come from approved assessments
      console.log(`✅ Approving jumbled assessment: ${assessment.satTitle}`);
      
      // Mark all questions as verified for jumbled assessments
      assessment.questions.forEach(q => {
        q.verified = true;
      });
    } else {
      // Regular validation for non-jumbled assessments
      if (assessment.mathValidation.needsReview) {
        return res.status(400).json({
          success: false,
          message: "Cannot approve assessment with unverified math questions",
          details: {
            totalMathQuestions: assessment.mathValidation.totalMathQuestions,
            verifiedMathQuestions: assessment.mathValidation.verifiedMathQuestions,
            verificationScore: assessment.mathValidation.verificationScore,
            needsReview: true
          },
          action: "Run math validation first or review questionable questions"
        });
      }
      
      // IMPROVED LOGIC: Check for questionable answers ONLY in actual math questions
      const questionableQuestions = assessment.questions.filter((q, index) => {
        if (q.type === 'mcq' && q.options && q.options.length === 4) {
          const correctOption = q.options[q.correctAnswer];
          
          // ONLY check questions in math sections
          const isMathSection = q.sectionType && q.sectionType.includes('math');
          
          if (isMathSection) {
            // For math sections, we expect answers to contain numbers
            // Check if the question actually requires a numeric answer
            const isActualMathQuestion = (
              // Contains math symbols
              /[+\-*/=^√π]/.test(q.questionText) ||
              // Contains math words
              /\b(solve|calculate|find|value|equation|expression|sum|difference|product|quotient|fraction|decimal|percent|angle|area|volume|probability)\b/i.test(q.questionText) ||
              // Contains actual math expressions (like 2x + 3 = 5)
              /\d+\s*[+\-*/]\s*\d+/.test(q.questionText) ||
              /x\s*[=+\-*/]/.test(q.questionText)
            );
            
            if (isActualMathQuestion) {
              // For actual math questions, answer should contain numbers
              const hasNumbersInAnswer = /\d/.test(correctOption);
              return !hasNumbersInAnswer;
            }
          } else {
            // For reading/writing sections, allow non-numeric answers
            // But we should still check for common issues
            const looksLikeMathByMistake = /^\d+$/.test(correctOption) && 
                                          !/\b(page|chapter|year|century|paragraph|line)\b/i.test(q.questionText);
            
            if (looksLikeMathByMistake) {
              console.warn(`⚠️ Non-math question has numeric answer: "${q.questionText.substring(0, 50)}..."`);
              return false; // Don't block approval, just warn
            }
          }
        }
        return false;
      });
      
      if (questionableQuestions.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Found questionable math answers in actual math questions",
          details: {
            questionableCount: questionableQuestions.length,
            questions: questionableQuestions.map((q, i) => ({
              index: assessment.questions.indexOf(q),
              questionText: q.questionText.substring(0, 100) + '...',
              sectionType: q.sectionType,
              markedAnswer: q.options[q.correctAnswer],
              issue: "Math question answer doesn't contain numbers"
            }))
          },
          action: "Review these math questions before approving"
        });
      }
    }

    // Additional verification - check if any correctAnswer index is invalid
    const invalidAnswerIndexes = assessment.questions
      .filter(q => q.type === 'mcq' && q.options)
      .map((q, index) => ({
        question: index,
        correctAnswer: q.correctAnswer,
        optionsLength: q.options.length,
        isValid: q.correctAnswer >= 0 && q.correctAnswer < q.options.length
      }))
      .filter(item => !item.isValid);
    
    if (invalidAnswerIndexes.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Found questions with invalid answer indexes",
        details: {
          invalidCount: invalidAnswerIndexes.length,
          questions: invalidAnswerIndexes.map(item => ({
            index: item.question,
            correctAnswerIndex: item.correctAnswer,
            optionsAvailable: item.optionsLength,
            issue: "Correct answer index is out of bounds"
          }))
        },
        action: "Fix answer indexes before approving"
      });
    }

    assessment.isApproved = true;
    assessment.status = 'published';
    assessment.publishedAt = new Date();
    
    // Update math validation for jumbled assessments
    if (isJumbled) {
      const mathQuestions = assessment.questions.filter(q => 
        q.sectionType && (q.sectionType.includes('math') || q.sectionType === 'mixed')
      );
      
      assessment.mathValidation = {
        totalMathQuestions: mathQuestions.length,
        verifiedMathQuestions: mathQuestions.length, // All verified for jumbled
        verificationScore: 100,
        needsReview: false
      };
    }
    
    await assessment.save();

    res.json({ 
      success: true,
      message: `SAT Assessment ${isJumbled ? '(Jumbled) ' : ''}approved and published successfully`,
      isJumbled: isJumbled,
      validation: {
        mathQuestions: assessment.mathValidation.totalMathQuestions,
        verifiedMath: assessment.mathValidation.verifiedMathQuestions,
        verificationScore: assessment.mathValidation.verificationScore,
        generationMethod: assessment.generatedBy,
        totalQuestions: assessment.questions.length,
        sections: [...new Set(assessment.questions.map(q => q.sectionType))]
      }
    });
  } catch (err) {
    console.error("Error approving SAT assessment", err);
    res.status(500).json({ 
      success: false,
      message: "Error approving SAT assessment",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};
// @desc    Get SAT student progress for teacher dashboard
// @route   GET /api/sat-assessments/teacher/student-progress
// @access  Private (Teacher only)
exports.getSatStudentProgress = async (req, res) => {
  try {
    const teacherId = req.user._id;

    // All submissions for this teacher's SAT assessments
    const submissions = await SatSubmission.find()
      .populate({
        path: "assessmentId",
        match: { teacherId },
        select: "satTitle sectionType teacherId",
      })
      .populate({
        path: "studentId",
        select: "name class",
      });

    // Keep only this teacher's
    const filtered = submissions.filter((s) => s.assessmentId);

    // 🔎 Build sets to query feedbacks (Feedback schema has studentId + assessmentId)
    const studentIds = filtered.map((s) => s.studentId?._id).filter(Boolean);
    const assessmentIds = filtered.map((s) => s.assessmentId?._id).filter(Boolean);

    // ✅ Fetch SAT-specific feedbacks instead of generic feedback
    const existingFeedbacks = await SatFeedback.find({
      studentId: { $in: studentIds },
      assessmentId: { $in: assessmentIds },
    }).select("studentId assessmentId");


    // Fast lookup: studentId-assessmentId -> true
    const sentSet = new Set(
      existingFeedbacks.map(
        (f) => `${f.studentId.toString()}-${f.assessmentId.toString()}`
      )
    );

    const formatted = filtered.map((s) => {
      const perc =
        s.percentage ??
        (s.totalMarks ? Number(((s.score / s.totalMarks) * 100).toFixed(2)) : 0);

      const sentKey = `${s.studentId?._id?.toString() || ""}-${s.assessmentId?._id?.toString() || ""}`;
      const feedbackSent = sentSet.has(sentKey);

      return {
        studentName: s.studentId?.name || "Unknown",
        className: s.studentId?.class || "Unknown",
        assessmentTitle: s.assessmentId?.satTitle || "Untitled",
        sectionType: s.assessmentId?.sectionType || "General",
        score: s.score ?? 0,
        totalMarks: s.totalMarks ?? 0,
        percentage: perc,
        submittedDate: s.submittedAt || s.createdAt || null,
        timeTaken: s.timeTaken,
        feedbackSent,                              // ✅ reliable
        submissionId: s._id,
        studentId: s.studentId?._id,
        assessmentId: s.assessmentId?._id,
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error("❌ Error fetching SAT student progress:", err);
    res.status(500).json({ message: "Failed to fetch SAT student progress" });
  }
};
// ✅ Get detailed SAT progress for the logged-in student
exports.getMySatProgress = async (req, res) => {
  try {
    const studentId = req.user._id;

  const submissions = await SatSubmission.find({ studentId })
     .populate("assessmentId", "satTitle sectionType difficulty")
     .populate("studentId", "name email")  // ✅ add this
     .sort({ createdAt: -1 });


const rows = submissions
  .filter(s => s.assessmentId) // 🚀 ignore orphan submissions
  .map((s) => ({
    _id: s._id,
    assessmentTitle: s.assessmentId?.satTitle || "Untitled",
    sectionType: s.assessmentId?.sectionType || "Unknown",
    difficulty: s.assessmentId?.difficulty || "—",
    score: s.score ?? 0,
    totalMarks: s.totalMarks ?? 0,
    percentage: typeof s.percentage === "number" ? s.percentage : 0,
    submittedDate: s.submittedAt || s.createdAt || null,
    timeTaken: s.timeTaken ?? 0,
    studentName: s.studentId?.name || "Unknown",   
    studentEmail: s.studentId?.email || "Unknown", 
  }));

    res.json(rows);
  } catch (err) {
    console.error("❌ Failed to fetch student's SAT progress:", err);
    res.status(500).json({ message: "Failed to fetch SAT progress" });
  }
};

exports.testMathGeneration = async (req, res) => {
  try {
    const { sectionType = 'math_no_calc', difficulty = 'medium', count = 5 } = req.body;
    
    if (!sectionType.includes('math')) {
      return res.status(400).json({ 
        success: false,
        message: 'This endpoint is for math sections only' 
      });
    }
    
    console.log(`🧪 Testing Math-First generation: ${sectionType}, ${difficulty}, ${count} questions`);
    
    const questions = await generateMathQuestions(sectionType, difficulty, count);
    
    // Verify all answers are correct
    const verificationResults = questions.map((q, index) => {
      const correctOption = q.options[q.correctAnswer];
      const isVerified = q.verified === true;
      const hasMath = /[0-9+\-*/=]/.test(q.questionText);
      
      return {
        question: index + 1,
        questionText: q.questionText.substring(0, 50) + '...',
        correctAnswerIndex: q.correctAnswer,
        correctAnswerValue: correctOption,
        verified: isVerified,
        hasMath: hasMath,
        templateType: q.templateType,
        valid: isVerified && hasMath
      };
    });
    
    const allValid = verificationResults.every(r => r.valid);
    
    res.json({
      success: true,
      message: `Generated ${questions.length} math questions using Math-First approach`,
      sectionType,
      difficulty,
      generatedCount: questions.length,
      verification: {
        allValid: allValid,
        verifiedCount: verificationResults.filter(r => r.verified).length,
        mathQuestionCount: verificationResults.filter(r => r.hasMath).length,
        details: verificationResults
      },
      questions: questions.map(q => ({
        questionText: q.questionText,
        options: q.options,
        correctAnswer: q.correctAnswer,
        correctValue: q.options[q.correctAnswer],
        verified: q.verified,
        templateType: q.templateType
      })),
      recommendation: allValid ? 
        '✅ Math-First approach is working correctly!' : 
        '⚠️ Some questions need review'
    });
    
  } catch (err) {
    console.error('❌ Math generation test error:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to test math generation',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

exports.validateMathQuestions = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const { questionIndexes } = req.body; // Optional: specific questions to validate
    
    const assessment = await SatAssessment.findById(assessmentId);
    if (!assessment) {
      return res.status(404).json({ message: "Assessment not found" });
    }
    
    // Only the teacher who created it can validate
    if (assessment.teacherId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }
    
    const mathQuestions = assessment.questions.filter((q, index) => {
      if (questionIndexes && questionIndexes.length > 0) {
        return questionIndexes.includes(index) && q.sectionType && q.sectionType.includes('math');
      }
      return q.sectionType && q.sectionType.includes('math');
    });
    
    const validationResults = [];
    let fixedCount = 0;
    
    for (let i = 0; i < mathQuestions.length; i++) {
      const qIndex = assessment.questions.indexOf(mathQuestions[i]);
      const q = mathQuestions[i];
      
      if (q.type === 'mcq' && q.options && q.options.length === 4) {
        // Quick validation: check if answer looks plausible
        const correctOption = q.options[q.correctAnswer];
        const hasNumbers = /\d/.test(correctOption);
        const isFraction = /^\d+\/\d+$/.test(correctOption);
        const isDecimal = /^\d+(\.\d+)?$/.test(correctOption);
        
        const isValid = hasNumbers && (isFraction || isDecimal || /[0-9]/.test(correctOption));
        
        validationResults.push({
          questionIndex: qIndex,
          questionText: q.questionText.substring(0, 100) + '...',
          currentAnswer: {
            index: q.correctAnswer,
            value: correctOption,
            display: String.fromCharCode(65 + q.correctAnswer)
          },
          isValid: isValid,
          issues: isValid ? [] : ['Answer does not appear to be a valid math answer'],
          suggestedFix: isValid ? null : {
            action: 'needs_review',
            message: 'Teacher should review this question'
          }
        });
        
        if (!isValid) {
          assessment.questions[qIndex].verified = false;
          fixedCount++;
        }
      }
    }
    
    // Update verification stats
    const allMathQuestions = assessment.questions.filter(q => 
      q.sectionType && q.sectionType.includes('math')
    );
    const verifiedMath = allMathQuestions.filter(q => q.verified === true).length;
    
    assessment.mathValidation = {
      totalMathQuestions: allMathQuestions.length,
      verifiedMathQuestions: verifiedMath,
      verificationScore: allMathQuestions.length > 0 
        ? Math.round((verifiedMath / allMathQuestions.length) * 100)
        : 100,
      needsReview: allMathQuestions.length > 0 && verifiedMath < allMathQuestions.length
    };
    
    if (assessment.mathValidation.needsReview) {
      assessment.status = 'needs_review';
    }
    
    await assessment.save();
    
    res.json({
      success: true,
      message: `Validated ${mathQuestions.length} math questions`,
      assessmentId: assessment._id,
      validation: {
        totalChecked: mathQuestions.length,
        valid: validationResults.filter(r => r.isValid).length,
        needsReview: validationResults.filter(r => !r.isValid).length,
        fixedCount: fixedCount,
        results: validationResults
      },
      verificationStatus: assessment.mathValidation,
      recommendation: assessment.mathValidation.needsReview ? 
        'Some math questions need review before publishing' :
        'All math questions appear valid'
    });
    
  } catch (err) {
    console.error('Math validation error:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to validate math questions' 
    });
  }
};

exports.fixMathQuestion = async (req, res) => {
  try {
    const { assessmentId, questionIndex } = req.params;
    const { correctAnswerIndex } = req.body;
    
    const assessment = await SatAssessment.findById(assessmentId);
    if (!assessment) {
      return res.status(404).json({ message: "Assessment not found" });
    }
    
    if (assessment.teacherId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }
    
    if (questionIndex < 0 || questionIndex >= assessment.questions.length) {
      return res.status(400).json({ message: "Invalid question index" });
    }
    
    const question = assessment.questions[questionIndex];
    
    if (question.type !== 'mcq' || !question.options || question.options.length !== 4) {
      return res.status(400).json({ message: "Not a valid MCQ question" });
    }
    
    if (correctAnswerIndex < 0 || correctAnswerIndex >= question.options.length) {
      return res.status(400).json({ 
        message: `correctAnswerIndex must be between 0 and ${question.options.length - 1}` 
      });
    }
    
    // Update the correct answer
    assessment.questions[questionIndex].correctAnswer = correctAnswerIndex;
    assessment.questions[questionIndex].verified = true;
    assessment.questions[questionIndex].lastValidated = new Date();
    
    // Update validation stats
    const mathQuestions = assessment.questions.filter(q => 
      q.sectionType && q.sectionType.includes('math')
    );
    const verifiedMath = mathQuestions.filter(q => q.verified === true).length;
    
    assessment.mathValidation = {
      totalMathQuestions: mathQuestions.length,
      verifiedMathQuestions: verifiedMath,
      verificationScore: mathQuestions.length > 0 
        ? Math.round((verifiedMath / mathQuestions.length) * 100)
        : 100,
      needsReview: mathQuestions.length > 0 && verifiedMath < mathQuestions.length
    };
    
    if (!assessment.mathValidation.needsReview && assessment.status === 'needs_review') {
      assessment.status = 'draft';
    }
    
    await assessment.save();
    
    res.json({
      success: true,
      message: "Question fixed successfully",
      question: {
        index: questionIndex,
        questionText: question.questionText.substring(0, 100) + '...',
        oldAnswer: question.options[question.correctAnswer],
        newAnswer: question.options[correctAnswerIndex],
        options: question.options.map((opt, i) => ({
          letter: String.fromCharCode(65 + i),
          value: opt,
          isCorrect: i === correctAnswerIndex
        }))
      },
      verificationStatus: assessment.mathValidation
    });
    
  } catch (err) {
    console.error('Fix math question error:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fix question' 
    });
  }
};
// @desc    Create a jumbled assessment
// @route   POST /api/sat-assessments/jumble
// @access  Private (Teacher only)
exports.createJumbledAssessment = async (req, res) => {
  try {
    const teacherId = req.user._id;
    const { name, difficulty, sourceAssessmentIds, questionsPerSource } = req.body;

    if (!name || !difficulty || !sourceAssessmentIds || sourceAssessmentIds.length < 2) {
      return res.status(400).json({ 
        success: false,
        message: "Please provide name, difficulty, and at least 2 source assessment IDs" 
      });
    }

    // Get teacher's school ID
    const teacher = await Teacher.findById(teacherId).select("schoolId");
    const schoolId = teacher.schoolId;

    // Validate all source assessments exist and are approved
    const sourceAssessments = await SatAssessment.find({
      _id: { $in: sourceAssessmentIds },
      difficulty: difficulty,
      isApproved: true,
      isJumbled: false // Don't use already jumbled assessments as sources
    }).select("satTitle questions difficulty sectionType teacherId");

    if (sourceAssessments.length !== sourceAssessmentIds.length) {
      const foundIds = sourceAssessments.map(a => a._id.toString());
      const missingIds = sourceAssessmentIds.filter(id => !foundIds.includes(id));
      
      return res.status(400).json({ 
        success: false,
        message: "Some source assessments not found, not approved, wrong difficulty, or are already jumbled",
        missingIds: missingIds
      });
    }

    // Determine standard question count for this difficulty
    const standardCounts = {
      'easy': 20,
      'medium': 25,
      'hard': 30,
      'very hard': 35
    };
    const targetQuestionCount = standardCounts[difficulty] || 25;
    
    // Calculate how many questions to take from each source
    let questionsPerAssessment = questionsPerSource || 2;
    
    // Adjust to reach target question count
    const totalQuestionsWithCurrentSetting = questionsPerAssessment * sourceAssessments.length;
    if (totalQuestionsWithCurrentSetting < targetQuestionCount) {
      // Calculate max we can take from each source
      const maxQuestionsPerSource = sourceAssessments.reduce((min, source) => {
        const validCount = source.questions.filter(q => 
          q.type === 'mcq' && q.options && q.options.length === 4
        ).length;
        return Math.min(min, validCount);
      }, Infinity);
      
      // Try to reach target
      const neededPerSource = Math.ceil(targetQuestionCount / sourceAssessments.length);
      questionsPerAssessment = Math.min(neededPerSource, maxQuestionsPerSource);
    }

    // Collect questions from each source
    const jumbledQuestions = [];
    const questionSources = [];
    
    for (const source of sourceAssessments) {
      // Filter valid MCQ questions
      const validQuestions = source.questions.filter(q => 
        q.type === 'mcq' && 
        q.options && 
        q.options.length === 4 &&
        typeof q.correctAnswer === 'number' &&
        q.correctAnswer >= 0 &&
        q.correctAnswer < 4
      );

      if (validQuestions.length === 0) {
        console.warn(`⚠️ No valid MCQ questions in assessment: ${source.satTitle}`);
        continue;
      }

      // Shuffle and take requested number
      const shuffled = [...validQuestions].sort(() => Math.random() - 0.5);
      const takeCount = Math.min(questionsPerAssessment, shuffled.length);
      const selected = shuffled.slice(0, takeCount);

      // Add to jumbled questions with source tracking
      selected.forEach((q, index) => {
        const originalIndex = source.questions.findIndex(
          originalQ => originalQ.questionText === q.questionText
        );
        
        jumbledQuestions.push({
          type: q.type,
          questionText: q.questionText,
          passage: q.passage || '',
          options: [...q.options], // Create a copy
          correctAnswer: q.correctAnswer,
          marks: q.marks || 1,
          sectionType: q.sectionType || source.sectionType,
          difficulty: q.difficulty || difficulty,
          fromAI: q.fromAI || false,
          verified: q.verified || true, // Jumbled questions are considered verified
          originalAssessmentId: source._id,
          originalQuestionIndex: originalIndex >= 0 ? originalIndex : index
        });
      });
      
      questionSources.push({
        sourceId: source._id,
        sourceTitle: source.satTitle,
        questionsTaken: selected.length,
        totalQuestions: source.questions.length
      });
    }

    // Shuffle all collected questions
    const shuffledQuestions = [...jumbledQuestions].sort(() => Math.random() - 0.5);

    if (shuffledQuestions.length === 0) {
      return res.status(400).json({ 
        success: false,
        message: "No valid questions found in source assessments" 
      });
    }

    // If we don't have enough questions, try to get more from available sources
    if (shuffledQuestions.length < targetQuestionCount) {
      console.log(`⚠️ Only ${shuffledQuestions.length}/${targetQuestionCount} questions collected, trying to get more...`);
      
      // Try to get more questions from sources that have them
      for (const source of sourceAssessments) {
        if (shuffledQuestions.length >= targetQuestionCount) break;
        
        const alreadyTaken = shuffledQuestions.filter(q => 
          q.originalAssessmentId.toString() === source._id.toString()
        ).length;
        
        const validQuestions = source.questions.filter(q => 
          q.type === 'mcq' && 
          q.options && 
          q.options.length === 4 &&
          typeof q.correctAnswer === 'number' &&
          q.correctAnswer >= 0 &&
          q.correctAnswer < 4
        );
        
        const available = validQuestions.length - alreadyTaken;
        const needed = targetQuestionCount - shuffledQuestions.length;
        
        if (available > 0) {
          const toTake = Math.min(available, needed);
          const shuffledRemaining = validQuestions
            .filter(q => !shuffledQuestions.some(jq => jq.questionText === q.questionText))
            .sort(() => Math.random() - 0.5)
            .slice(0, toTake);
          
          shuffledRemaining.forEach((q, index) => {
            const originalIndex = source.questions.findIndex(
              originalQ => originalQ.questionText === q.questionText
            );
            
            shuffledQuestions.push({
              type: q.type,
              questionText: q.questionText,
              passage: q.passage || '',
              options: [...q.options],
              correctAnswer: q.correctAnswer,
              marks: q.marks || 1,
              sectionType: q.sectionType || source.sectionType,
              difficulty: q.difficulty || difficulty,
              fromAI: q.fromAI || false,
              verified: q.verified || true,
              originalAssessmentId: source._id,
              originalQuestionIndex: originalIndex >= 0 ? originalIndex : index
            });
          });
          
          // Update question sources
          const sourceInfo = questionSources.find(s => s.sourceId.toString() === source._id.toString());
          if (sourceInfo) {
            sourceInfo.questionsTaken += toTake;
          }
        }
      }
    }

    // Final shuffle
    const finalQuestions = [...shuffledQuestions].sort(() => Math.random() - 0.5);

    // Calculate math validation stats
    const mathQuestions = finalQuestions.filter(q => 
      q.sectionType && (q.sectionType.includes('math') || q.sectionType === 'mixed')
    );
    const verifiedMath = mathQuestions.filter(q => q.verified === true).length;

    // Create the jumbled assessment
    const jumbledAssessment = new SatAssessment({
      teacherId,
      schoolId,
      satTitle: name,
      sectionType: 'mixed',
      difficulty,
      questions: finalQuestions,
      isJumbled: true,
      sourceAssessments: sourceAssessmentIds,
      isApproved: false, // Teacher needs to review
      status: "draft",
      mathValidation: {
        totalMathQuestions: mathQuestions.length,
        verifiedMathQuestions: verifiedMath,
        verificationScore: mathQuestions.length > 0 
          ? Math.round((verifiedMath / mathQuestions.length) * 100)
          : 100,
        needsReview: mathQuestions.length > 0 && verifiedMath < mathQuestions.length
      },
      generatedBy: 'jumbled',
      fileType: 'jumbled',
      estimatedTime: difficulty === 'easy' ? 30 : 
                    difficulty === 'medium' ? 45 : 
                    difficulty === 'hard' ? 60 : 75
    });

    await jumbledAssessment.save();

    res.status(201).json({
      success: true,
      message: `Jumbled assessment created successfully with ${finalQuestions.length} questions`,
      assessment: {
        id: jumbledAssessment._id,
        name: jumbledAssessment.satTitle,
        difficulty,
        totalQuestions: finalQuestions.length,
        targetQuestionCount: targetQuestionCount,
        sources: sourceAssessments.length,
        mathQuestions: mathQuestions.length,
        verifiedMath: verifiedMath,
        status: "draft",
        questionSources: questionSources
      }
    });

  } catch (err) {
    console.error("❌ Jumbling error:", err);
    res.status(500).json({ 
      success: false,
      message: "Failed to create jumbled assessment",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// @desc    Get assessments suitable for jumbling
// @route   GET /api/sat-assessments/available-for-jumbling
// @access  Private (Teacher only)
exports.getAssessmentsForJumbling = async (req, res) => {
  try {
    const teacherId = req.user._id;
    const { difficulty } = req.query;

    // Build filter - only get approved assessments with enough questions
    const filter = { 
      teacherId, 
      isApproved: true,
      isJumbled: false, // Don't include already jumbled assessments
      status: { $in: ['published', 'draft'] }
    };
    
    // Add difficulty filter if provided
    if (difficulty && difficulty !== 'all') {
      filter.difficulty = difficulty;
    }

    const assessments = await SatAssessment.find(filter)
      .select("satTitle difficulty sectionType questions isJumbled isApproved createdAt mathValidation")
      .sort({ createdAt: -1 });

    // Calculate standard question count for each difficulty
    const standardCounts = {
      'easy': 20,
      'medium': 25,
      'hard': 30,
      'very hard': 35
    };

    // Format response with question counts
    const formatted = assessments.map(a => {
      const validMCQCount = a.questions.filter(q => 
        q.type === 'mcq' && q.options && q.options.length === 4
      ).length;
      
      const standardCount = standardCounts[a.difficulty] || 25;
      const hasEnoughQuestions = validMCQCount >= Math.ceil(standardCount / 3); // At least 1/3 of standard count
      
      return {
        _id: a._id,
        title: a.satTitle,
        difficulty: a.difficulty,
        sectionType: a.sectionType,
        totalQuestions: a.questions.length,
        validMCQCount: validMCQCount,
        isJumbled: a.isJumbled || false,
        isApproved: a.isApproved,
        hasEnoughQuestions: hasEnoughQuestions,
        standardCount: standardCount,
        createdAt: a.createdAt
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error("❌ Error fetching assessments for jumbling:", err);
    res.status(500).json({ 
      success: false,
      message: "Failed to fetch assessments for jumbling" 
    });
  }
};
// @desc    Preview jumbled assessment
// @route   POST /api/sat-assessments/jumble/preview
// @access  Private (Teacher only)
exports.previewJumbledAssessment = async (req, res) => {
  try {
    const { sourceAssessmentIds, questionsPerSource } = req.body;

    if (!sourceAssessmentIds || !Array.isArray(sourceAssessmentIds) || sourceAssessmentIds.length < 2) {
      return res.status(400).json({ 
        success: false,
        message: "Please provide at least 2 source assessment IDs" 
      });
    }

    // Get source assessments
    const sourceAssessments = await SatAssessment.find({
      _id: { $in: sourceAssessmentIds },
      isApproved: true,
      isJumbled: false // Don't use already jumbled assessments as sources
    }).select("satTitle questions difficulty sectionType");

    if (sourceAssessments.length !== sourceAssessmentIds.length) {
      const foundIds = sourceAssessments.map(a => a._id.toString());
      const missingIds = sourceAssessmentIds.filter(id => !foundIds.includes(id));
      
      return res.status(400).json({ 
        success: false,
        message: "Some source assessments not found, not approved, or are already jumbled",
        missingIds: missingIds
      });
    }

    // Check if all assessments have the same difficulty
    const difficulties = [...new Set(sourceAssessments.map(a => a.difficulty))];
    if (difficulties.length > 1) {
      return res.status(400).json({
        success: false,
        message: "Cannot combine assessments with different difficulty levels",
        difficulties: difficulties
      });
    }

    const difficulty = difficulties[0];
    
    // Determine standard question count for this difficulty
    const standardCounts = {
      'easy': 20,
      'medium': 25,
      'hard': 30,
      'very hard': 35
    };
    const targetQuestionCount = standardCounts[difficulty] || 25;
    
    // Calculate how many questions to take from each source
    const totalValidQuestions = sourceAssessments.reduce((sum, source) => {
      return sum + source.questions.filter(q => 
        q.type === 'mcq' && q.options && q.options.length === 4
      ).length;
    }, 0);
    
    let questionsPerAssessment = questionsPerSource || 2;
    
    // If we need more questions to reach target, adjust
    const totalQuestionsWithCurrentSetting = questionsPerAssessment * sourceAssessments.length;
    if (totalQuestionsWithCurrentSetting < targetQuestionCount) {
      // Try to increase questions per source
      const maxPossiblePerSource = Math.min(
        Math.floor(totalValidQuestions / sourceAssessments.length),
        Math.ceil(targetQuestionCount / sourceAssessments.length)
      );
      
      if (maxPossiblePerSource > questionsPerAssessment) {
        questionsPerAssessment = maxPossiblePerSource;
      }
    }

    // Collect questions from each source
    const previewQuestions = [];
    const questionDistribution = [];
    
    for (const source of sourceAssessments) {
      // Filter valid MCQ questions
      const validQuestions = source.questions.filter(q => 
        q.type === 'mcq' && q.options && q.options.length === 4
      );

      if (validQuestions.length === 0) {
        console.warn(`⚠️ No valid MCQ questions in assessment: ${source.satTitle}`);
        questionDistribution.push({
          title: source.satTitle,
          totalQuestions: source.questions.length,
          validQuestions: 0,
          taken: 0,
          available: 0
        });
        continue;
      }

      // Shuffle and take requested number
      const shuffled = [...validQuestions].sort(() => Math.random() - 0.5);
      const takeCount = Math.min(questionsPerAssessment, shuffled.length);
      const selected = shuffled.slice(0, takeCount);

      // Add to preview questions
      selected.forEach(q => {
        previewQuestions.push({
          questionText: q.questionText,
          correctAnswer: q.correctAnswer,
          sourceTitle: source.satTitle,
          type: q.type,
          options: q.options,
          marks: q.marks || 1,
          sectionType: q.sectionType
        });
      });
      
      questionDistribution.push({
        title: source.satTitle,
        totalQuestions: source.questions.length,
        validQuestions: validQuestions.length,
        taken: selected.length,
        available: validQuestions.length
      });
    }

    if (previewQuestions.length === 0) {
      return res.status(400).json({ 
        success: false,
        message: "No valid MCQ questions found in selected assessments" 
      });
    }

    // Calculate if we need additional questions
    const additionalNeeded = Math.max(0, targetQuestionCount - previewQuestions.length);
    
    res.json({
      success: true,
      totalQuestions: previewQuestions.length,
      targetQuestionCount: targetQuestionCount,
      difficulty: difficulty,
      additionalNeeded: additionalNeeded,
      questionsPerAssessment: questionsPerAssessment,
      sampleQuestions: previewQuestions.slice(0, 5), // Show first 5 as sample
      questionDistribution: questionDistribution,
      sources: sourceAssessments.map(s => ({
        id: s._id,
        title: s.satTitle,
        difficulty: s.difficulty,
        sectionType: s.sectionType,
        totalQuestions: s.questions.length,
        validMCQCount: s.questions.filter(q => 
          q.type === 'mcq' && q.options && q.options.length === 4
        ).length
      }))
    });

  } catch (err) {
    console.error("❌ Preview jumbling error:", err);
    res.status(500).json({ 
      success: false,
      message: "Failed to generate preview",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};


// @desc    Get jumbled assessments
// @route   GET /api/sat-assessments/jumbled/list
// @access  Private (Teacher only)
exports.getJumbledAssessments = async (req, res) => {
  try {
    const teacherId = req.user._id;
    
    const jumbledAssessments = await SatAssessment.find({
      teacherId,
      isJumbled: true
    })
    .select("satTitle difficulty sectionType questions isApproved status createdAt sourceAssessments")
    .sort({ createdAt: -1 })
    .populate("sourceAssessments", "satTitle difficulty");

    // Format the response
    const formatted = jumbledAssessments.map(assessment => {
      const sourceCount = assessment.sourceAssessments?.length || 0;
      const validQuestions = assessment.questions.filter(q => 
        q.type === 'mcq' && q.options && q.options.length === 4
      ).length;

      return {
        _id: assessment._id,
        title: assessment.satTitle,
        difficulty: assessment.difficulty,
        sectionType: assessment.sectionType,
        totalQuestions: assessment.questions.length,
        validQuestions: validQuestions,
        sources: sourceCount,
        isApproved: assessment.isApproved,
        status: assessment.status,
        createdAt: assessment.createdAt,
        sourceTitles: assessment.sourceAssessments?.map(s => s.satTitle) || []
      };
    });

    res.json({
      success: true,
      count: formatted.length,
      assessments: formatted
    });
  } catch (err) {
    console.error("❌ Error fetching jumbled assessments:", err);
    res.status(500).json({ 
      success: false,
      message: "Failed to fetch jumbled assessments" 
    });
  }
};
// @desc    Validate SAT difficulty alignment
// @route   POST /api/sat-assessments/:id/validate-sat-alignment
// @access  Private (Teacher only)
exports.validateSATAlignment = async (req, res) => {
  try {
    const { id } = req.params;
    console.log("🔍 Validating assessment ID:", id);
    
    const assessment = await SatAssessment.findById(id);
    
    if (!assessment) {
      return res.status(404).json({ message: "Assessment not found" });
    }
    
    if (assessment.teacherId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }
    
    const validationResults = {
      assessmentId: assessment._id,
      satTitle: assessment.satTitle,
      difficulty: assessment.difficulty,
      sectionType: assessment.sectionType,
      totalQuestions: assessment.questions.length,
      mathQuestions: 0,
      readingWritingQuestions: 0,
      issues: [],
      recommendations: [],
      alignmentScore: 0
    };
    
    // ========== DIFFICULTY-SPECIFIC VALIDATION RULES ==========
    
    // Analyze each question
    assessment.questions.forEach((q, index) => {
      // Count by type
      if (q.sectionType && q.sectionType.includes('math')) {
        validationResults.mathQuestions++;
        
        // ===== EASY LEVEL VALIDATION =====
        if (assessment.difficulty === 'easy') {
          // ❌ BAD: Basic arithmetic (NOT SAT appropriate)
          const isBasicArithmetic = (
            (q.questionText.includes('What is') && 
             (q.questionText.includes(' + ') || 
              q.questionText.includes(' × ') || 
              q.questionText.includes(' - ') ||
              q.questionText.includes(' ÷ ')) &&
             !q.questionText.includes('x') &&
             !q.questionText.includes('equation') &&
             q.questionText.split(' ').length < 10) ||
            
            (q.questionText.includes('%') && 
             q.questionText.includes('What is') &&
             !q.questionText.includes('sale') &&
             !q.questionText.includes('discount') &&
             !q.questionText.includes('price')) ||
            
            (q.questionText.includes('rectangle') && 
             q.questionText.includes('length') && 
             q.questionText.includes('width') &&
             !q.questionText.includes('solve'))
          );
          
          if (isBasicArithmetic) {
            validationResults.issues.push({
              questionNumber: index + 1,
              questionText: q.questionText.substring(0, 100) + (q.questionText.length > 100 ? '...' : ''),
              issues: ['❌ EASY: Question too basic - use algebra, exponents, ratios instead']
            });
          }
          
          // ✅ GOOD: SAT appropriate easy questions
          const isSATAppropriateEasy = (
            q.questionText.includes('x') && q.questionText.includes('=') ||
            q.questionText.includes('m^{') && q.questionText.includes('÷') ||
            q.questionText.includes('recipe') && q.questionText.includes('cups') ||
            q.questionText.includes('class') && q.questionText.includes('students') ||
            q.questionText.includes('%') && (q.questionText.includes('sale') || q.questionText.includes('discount')) ||
            q.questionText.includes('Simplify:')
          );
          
          if (!isSATAppropriateEasy && !isBasicArithmetic) {
            validationResults.issues.push({
              questionNumber: index + 1,
              questionText: q.questionText.substring(0, 100) + (q.questionText.length > 100 ? '...' : ''),
              issues: ['⚠️ EASY: Could be more SAT-like (add context or variables)']
            });
          }
        }
        
        // ===== MEDIUM LEVEL VALIDATION =====
        else if (assessment.difficulty === 'medium') {
          // ❌ BAD: Too simple for medium level
          const isTooSimpleForMedium = (
            q.questionText.includes('x') && 
            q.questionText.includes('=') &&
            !q.questionText.includes('²') &&
            !q.questionText.includes('system') &&
            !q.questionText.includes('function') &&
            q.questionText.split(' ').length < 15
          );
          
          if (isTooSimpleForMedium) {
            validationResults.issues.push({
              questionNumber: index + 1,
              questionText: q.questionText.substring(0, 100) + (q.questionText.length > 100 ? '...' : ''),
              issues: ['❌ MEDIUM: Too simple - should include quadratics, systems, or functions']
            });
          }
          
          // ✅ GOOD: SAT appropriate medium questions
          const isSATAppropriateMedium = (
            q.questionText.includes('x²') ||
            q.questionText.includes('quadratic') ||
            q.questionText.includes('(x +') && q.questionText.includes(') = 0') ||
            q.questionText.includes('y =') && q.questionText.includes('x +') ||
            q.questionText.includes('function') ||
            q.questionText.includes('probability') ||
            q.questionText.includes('circumference') ||
            q.questionText.includes('diameter')
          );
          
          if (!isSATAppropriateMedium && !isTooSimpleForMedium) {
            validationResults.issues.push({
              questionNumber: index + 1,
              questionText: q.questionText.substring(0, 100) + (q.questionText.length > 100 ? '...' : ''),
              issues: ['⚠️ MEDIUM: Consider adding quadratics, systems, or geometry']
            });
          }
        }
        
        // ===== HARD LEVEL VALIDATION =====
        else if (assessment.difficulty === 'hard') {
          // ❌ BAD: Too simple for hard level
          const isTooSimpleForHard = (
            q.questionText.includes('x²') && !q.questionText.includes('complex') ||
            q.questionText.includes('y =') && !q.questionText.includes('exponential') ||
            q.questionText.includes('probability') && !q.questionText.includes('compound')
          );
          
          if (isTooSimpleForHard) {
            validationResults.issues.push({
              questionNumber: index + 1,
              questionText: q.questionText.substring(0, 100) + (q.questionText.length > 100 ? '...' : ''),
              issues: ['❌ HARD: Too simple - should include exponential growth, trigonometry, or data analysis']
            });
          }
          
          // ✅ GOOD: SAT appropriate hard questions
          const isSATAppropriateHard = (
            q.questionText.includes('exponential') ||
            q.questionText.includes('compound') ||
            q.questionText.includes('trigonometry') ||
            q.questionText.includes('hypotenuse') ||
            q.questionText.includes('angle') ||
            q.questionText.includes('mean') && q.questionText.includes('five numbers') ||
            q.questionText.includes('quadratic formula')
          );
          
          if (!isSATAppropriateHard && !isTooSimpleForHard) {
            validationResults.issues.push({
              questionNumber: index + 1,
              questionText: q.questionText.substring(0, 100) + (q.questionText.length > 100 ? '...' : ''),
              issues: ['⚠️ HARD: Consider adding exponential, trig, or advanced algebra']
            });
          }
        }
        
        // ===== VERY HARD LEVEL VALIDATION =====
        else if (assessment.difficulty === 'very hard') {
          // ❌ BAD: Too simple for very hard level
          const isTooSimpleForVeryHard = (
            q.questionText.includes('exponential') && q.questionText.includes('years') ||
            q.questionText.includes('quadratic') && !q.questionText.includes('roots that differ')
          );
          
          if (isTooSimpleForVeryHard) {
            validationResults.issues.push({
              questionNumber: index + 1,
              questionText: q.questionText.substring(0, 100) + (q.questionText.length > 100 ? '...' : ''),
              issues: ['❌ VERY HARD: Not challenging enough - needs multi-step reasoning']
            });
          }
          
          // ✅ GOOD: SAT appropriate very hard questions
          const isSATAppropriateVeryHard = (
            q.questionText.includes('roots that differ') ||
            q.questionText.includes('function composition') ||
            q.questionText.includes('circle equation') ||
            q.questionText.includes('distance from center') ||
            q.questionText.includes('Two fair six-sided dice') ||
            q.questionText.includes('probability that the sum is') ||
            q.questionText.includes('system') && q.questionText.includes('complex')
          );
          
          if (!isSATAppropriateVeryHard && !isTooSimpleForVeryHard) {
            validationResults.issues.push({
              questionNumber: index + 1,
              questionText: q.questionText.substring(0, 100) + (q.questionText.length > 100 ? '...' : ''),
              issues: ['⚠️ VERY HARD: Should include multi-step, composition, or advanced concepts']
            });
          }
        }
        
      } else {
        validationResults.readingWritingQuestions++;
        // Add reading/writing validation here if needed
      }
    });
    
    // ===== CALCULATE ALIGNMENT SCORE =====
    const totalIssues = validationResults.issues.length;
    const maxIssues = assessment.questions.length;
    validationResults.alignmentScore = Math.max(0, 100 - (totalIssues * (100 / maxIssues)));
    
    // ===== GENERATE RECOMMENDATIONS =====
    const criticalIssues = validationResults.issues.filter(i => i.issues[0].includes('❌')).length;
    const warningIssues = validationResults.issues.filter(i => i.issues[0].includes('⚠️')).length;
    
    if (criticalIssues > 0) {
      validationResults.recommendations.push(
        `❌ CRITICAL: ${criticalIssues} questions are NOT appropriate for ${assessment.difficulty} level. Regenerate these.`
      );
    }
    
    if (warningIssues > 0) {
      validationResults.recommendations.push(
        `⚠️ WARNING: ${warningIssues} questions could be improved for better SAT alignment.`
      );
    }
    
    if (validationResults.alignmentScore < 70) {
      validationResults.recommendations.push(
        `📝 Recommendation: Regenerate this assessment with better ${assessment.difficulty}-level questions.`
      );
    } else if (validationResults.alignmentScore < 85) {
      validationResults.recommendations.push(
        `📝 Recommendation: Review and improve the flagged questions.`
      );
    } else {
      validationResults.recommendations.push(
        `✅ Good job! This assessment is well-aligned with SAT ${assessment.difficulty} level.`
      );
    }
    
    res.json({
      success: true,
      message: `SAT alignment analysis completed for ${assessment.satTitle} (${assessment.difficulty} level)`,
      ...validationResults,
      summary: {
        score: `${validationResults.alignmentScore.toFixed(1)}%`,
        critical: criticalIssues,
        warnings: warningIssues,
        status: validationResults.alignmentScore >= 85 ? '✅ PASS' : 
                validationResults.alignmentScore >= 70 ? '⚠️ REVIEW' : '❌ FAIL'
      }
    });
    
  } catch (err) {
    console.error('❌ SAT alignment validation error:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to validate SAT alignment',
      error: err.message
    });
  }
};