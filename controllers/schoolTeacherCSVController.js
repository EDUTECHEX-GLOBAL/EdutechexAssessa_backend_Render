const asyncHandler = require("express-async-handler");
const csv = require("csv-parser");
const stream = require("stream");
const SchoolTeacherCSV = require("../models/webapp-models/schoolTeacherCSVModel");
const Teacher = require("../models/webapp-models/teacherModel");
const crypto = require("crypto");
const sendEmail = require("../utils/mailer");

// ✅ ADD THIS IMPORT
const { createSchoolAdminNotification } = require("./schoolAdminNotificationController");

// Helper function to generate random password
const generatePassword = () => {
  return crypto.randomBytes(8).toString("hex");
};

// Helper function to validate email
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Helper function to validate teacher data
const validateTeacherData = (row, index) => {
  const errors = [];
  
  if (!row.name || row.name.trim().length < 2) {
    errors.push(`Row ${index}: Name is required and must be at least 2 characters`);
  }
  
  if (!row.email || !isValidEmail(row.email)) {
    errors.push(`Row ${index}: Valid email is required`);
  }
  
  if (!row.subject || row.subject.trim().length < 2) {
    errors.push(`Row ${index}: Subject is required`);
  }
  
  return errors;
};

// ✅ FIXED: POST /api/school-admin/bulk-upload/teachers
const bulkUploadTeachers = asyncHandler(async (req, res) => {
  try {
    console.log("=== TEACHER CSV UPLOAD STARTED ===");
    console.log("School Admin ID:", req.user._id);
    console.log("File received:", req.file?.originalname);
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: "No CSV file uploaded" 
      });
    }

    const schoolAdminId = req.user._id;
    const results = [];
    const errors = [];
    const processedRows = [];

    // Get school admin info for linking
    const SchoolAdmin = require("../models/webapp-models/schoolAdminModel");
    const schoolAdmin = await SchoolAdmin.findById(schoolAdminId);

    if (!schoolAdmin) {
      return res.status(404).json({
        success: false,
        message: "School admin not found"
      });
    }

    console.log(`✅ School Admin found: ${schoolAdmin.schoolName}`);

    // Create readable stream from buffer
    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    // ✅ FIX: Collect all rows first
    bufferStream
      .pipe(csv())
      .on("data", (row) => {
        processedRows.push(row);
      })
      .on("end", async () => {
        console.log(`📊 Processing ${processedRows.length} rows...`);
        
        let successCount = 0;
        let failCount = 0;
        let credentialsSentCount = 0;

        // ✅ PROCESS ROWS SEQUENTIALLY
        for (let i = 0; i < processedRows.length; i++) {
          const row = processedRows[i];
          const rowNumber = i + 1;
          
          console.log(`📝 Processing row ${rowNumber}:`, row);
          
          // Validate row data
          const rowErrors = validateTeacherData(row, rowNumber);
          
          if (rowErrors.length > 0) {
            errors.push(...rowErrors);
            failCount++;
            console.log(`❌ Row ${rowNumber} validation failed`);
            continue;
          }

          try {
            // ✅ Check if teacher already exists in MAIN Teacher collection
            const existingTeacher = await Teacher.findOne({
              email: row.email.trim().toLowerCase()
            });

            if (existingTeacher) {
              // UPDATE existing teacher instead of rejecting
              console.log(`🔄 Updating existing teacher: ${row.email}`);
              
              existingTeacher.schoolId = schoolAdminId;
              existingTeacher.schoolName = schoolAdmin.schoolName;
              existingTeacher.selectedSubjects = [row.subject.trim()];
              existingTeacher.className = row.qualification?.trim() || existingTeacher.className;
              existingTeacher.phone = row.phone?.trim() || existingTeacher.phone;
              
              const tempPassword = generatePassword();
              existingTeacher.password = tempPassword;
              
              await existingTeacher.save();
              
              // Find or create CSV record
              let csvTeacher = await SchoolTeacherCSV.findOne({
                email: row.email.trim().toLowerCase(),
                schoolAdmin: schoolAdminId
              });
              
              if (!csvTeacher) {
                csvTeacher = await SchoolTeacherCSV.create({
                  schoolAdmin: schoolAdminId,
                  name: row.name.trim(),
                  email: row.email.trim().toLowerCase(),
                  subject: row.subject.trim(),
                  qualification: row.qualification?.trim() || "",
                  phone: row.phone?.trim() || "",
                  experience: row.experience?.trim() || "",
                  temporaryPassword: tempPassword,
                  status: "active",
                  mainUserId: existingTeacher._id,
                  credentialsSent: false
                });
              }
              
              // ✅ SEND EMAIL USING mailer.js sendCredentialsEmail function
              let emailSent = false;
              try {
                console.log(`📧 Sending credentials to: ${row.email}`);
                
                await sendEmail.sendCredentialsEmail(
                  row.email.trim().toLowerCase(),
                  row.name.trim(),
                  tempPassword,
                  "teacher"
                );
                
                emailSent = true;
                console.log(`✅ Email sent successfully to: ${row.email}`);
                
              } catch (emailError) {
                console.error(`❌ Email failed for ${row.email}:`, emailError.message);
                // Continue even if email fails
              }
              
              if (emailSent) {
                csvTeacher.credentialsSent = true;
                csvTeacher.credentialsSentAt = new Date();
                await csvTeacher.save();
                credentialsSentCount++;
              }
              
              // ✅ ADD NOTIFICATION FOR UPDATED TEACHER
              await createSchoolAdminNotification(schoolAdminId, {
                type: "new_teacher_added",
                title: "Teacher Updated",
                message: `${row.name} (${row.email}) information has been updated`,
                data: {
                  teacherId: existingTeacher._id,
                  teacherName: row.name,
                  teacherEmail: row.email,
                  subject: row.subject,
                  status: "updated",
                  credentialsSent: emailSent
                },
                relatedUserId: existingTeacher._id
              });
              
              results.push({
                name: existingTeacher.name,
                email: existingTeacher.email,
                subject: row.subject.trim(),
                status: "updated",
                credentialsSent: emailSent,
                mainUserId: existingTeacher._id
              });
              successCount++;
              continue; // Skip to next row
            }

            // ✅ CREATE NEW TEACHER (if doesn't exist)
            const tempPassword = generatePassword();

            // Create teacher in MAIN Teacher collection
            const teacher = await Teacher.create({
              name: row.name.trim(),
              email: row.email.trim().toLowerCase(),
              password: tempPassword,
              role: "teacher",
              status: "pending",
              selectedSubjects: [row.subject.trim()],
              className: row.qualification?.trim() || "",
              schoolId: schoolAdminId,
              schoolName: schoolAdmin.schoolName,
              phone: row.phone?.trim() || "",
            });

            console.log(`✅ Created main teacher: ${teacher.email} (ID: ${teacher._id})`);

            // ✅ ADD NOTIFICATION FOR NEW TEACHER
            await createSchoolAdminNotification(schoolAdminId, {
              type: "new_teacher_added",
              title: "New Teacher Added",
              message: `${row.name} (${row.email}) has been added to your school`,
              data: {
                teacherId: teacher._id,
                teacherName: row.name,
                teacherEmail: row.email,
                subject: row.subject,
                status: "created",
                credentialsSent: false
              },
              relatedUserId: teacher._id
            });

            // Also create in SchoolTeacherCSV for tracking
            const csvTeacher = await SchoolTeacherCSV.create({
              schoolAdmin: schoolAdminId,
              name: row.name.trim(),
              email: row.email.trim().toLowerCase(),
              subject: row.subject.trim(),
              qualification: row.qualification?.trim() || "",
              phone: row.phone?.trim() || "",
              experience: row.experience?.trim() || "",
              temporaryPassword: tempPassword,
              status: "pending",
              mainUserId: teacher._id,
              credentialsSent: false
            });

            console.log(`✅ Created CSV record: ${csvTeacher.email}`);

            // ✅ SEND EMAIL USING mailer.js sendCredentialsEmail function
            let emailSent = false;
            try {
              console.log(`📧 Sending credentials to: ${row.email}`);
              
              await sendEmail.sendCredentialsEmail(
                row.email.trim().toLowerCase(),
                row.name.trim(),
                tempPassword,
                "teacher"
              );
              
              emailSent = true;
              console.log(`✅ Email sent successfully to: ${row.email}`);
              
            } catch (emailError) {
              console.error(`❌ Email failed for ${row.email}:`, emailError.message);
              // Continue even if email fails
            }

            if (emailSent) {
              csvTeacher.credentialsSent = true;
              csvTeacher.credentialsSentAt = new Date();
              await csvTeacher.save();
              credentialsSentCount++;
              
              // ✅ UPDATE NOTIFICATION WITH EMAIL STATUS
              await createSchoolAdminNotification(schoolAdminId, {
                type: "credentials_resent",
                title: "Credentials Sent",
                message: `Login credentials sent to ${row.email}`,
                data: {
                  teacherId: teacher._id,
                  teacherEmail: row.email,
                  credentialsSent: true
                },
                relatedUserId: teacher._id
              });
            }

            results.push({
              name: teacher.name,
              email: teacher.email,
              subject: row.subject.trim(),
              status: "created",
              credentialsSent: emailSent,
              mainUserId: teacher._id
            });
            successCount++;

          } catch (error) {
            console.error(`❌ Error processing row ${rowNumber}:`, error);
            errors.push(`Row ${rowNumber}: ${error.message}`);
            failCount++;
          }
        }

        // Update school admin's total teachers count
        if (successCount > 0) {
          try {
            await SchoolAdmin.findByIdAndUpdate(schoolAdminId, {
              $inc: { 
                totalTeachers: successCount,
                activeTeachers: successCount 
              }
            });
            console.log(`✅ Updated school admin stats: +${successCount} teachers`);
          } catch (error) {
            console.error("Error updating school admin stats:", error);
          }
        }

        console.log("=== CSV PROCESSING COMPLETE ===");
        console.log(`Total: ${processedRows.length}, Success: ${successCount}, Failed: ${failCount}`);
        console.log(`Emails sent: ${credentialsSentCount}/${successCount}`);
        
        res.json({
          success: true,
          message: `CSV processing completed. Processed: ${processedRows.length}, Success: ${successCount}, Failed: ${failCount}`,
          summary: {
            totalProcessed: processedRows.length,
            success: successCount,
            failed: failCount,
            credentialsSent: credentialsSentCount
          },
          results: results,
          errors: errors.length > 0 ? errors : undefined
        });
      })
      .on("error", (error) => {
        console.error("CSV stream error:", error);
        res.status(500).json({
          success: false,
          message: "Error processing CSV file",
          error: error.message
        });
      });

  } catch (error) {
    console.error("Bulk upload error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during CSV upload",
      error: error.message
    });
  }
});

// ✅ UPDATED: GET /api/school-admin/teachers
const getSchoolTeachers = asyncHandler(async (req, res) => {
  try {
    const schoolAdminId = req.user._id;
    const { status, search, page = 1, limit = 20 } = req.query;

    const query = { schoolAdmin: schoolAdminId };

    // Apply filters
    if (status && status !== "all") {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { subject: { $regex: search, $options: "i" } }
      ];
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get teachers with pagination
    const teachers = await SchoolTeacherCSV.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select("-temporaryPassword");

    // Get total count
    const total = await SchoolTeacherCSV.countDocuments(query);

    res.json({
      success: true,
      teachers,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error("Error fetching teachers:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching teachers"
    });
  }
});

// ✅ UPDATED: PATCH /api/school-admin/teachers/:id/toggle-status
const toggleTeacherStatus = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const csvTeacher = await SchoolTeacherCSV.findOne({
      _id: id,
      schoolAdmin: req.user._id
    });

    if (!csvTeacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found"
      });
    }

    // ✅ ALSO update main Teacher if linked
    if (csvTeacher.mainUserId) {
      await Teacher.findByIdAndUpdate(csvTeacher.mainUserId, {
        status: status
      });
    }

    csvTeacher.status = status;
    await csvTeacher.save();

    // ✅ ADD NOTIFICATION FOR STATUS CHANGE
    await createSchoolAdminNotification(req.user._id, {
      type: status === "active" ? "teacher_login" : "new_teacher_added",
      title: `Teacher Status ${status === "active" ? "Activated" : "Deactivated"}`,
      message: `${csvTeacher.name} (${csvTeacher.email}) has been ${status === "active" ? "activated" : "deactivated"}`,
      data: {
        teacherId: csvTeacher._id,
        teacherName: csvTeacher.name,
        teacherEmail: csvTeacher.email,
        previousStatus: csvTeacher.status,
        newStatus: status
      },
      relatedUserId: csvTeacher.mainUserId
    });

    res.json({
      success: true,
      message: `Teacher status updated to ${status}`,
      teacher: {
        _id: csvTeacher._id,
        name: csvTeacher.name,
        email: csvTeacher.email,
        status: csvTeacher.status
      }
    });
  } catch (error) {
    console.error("Error toggling teacher status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating teacher status"
    });
  }
});

// GET /api/school-admin/teachers/:id
const getTeacherDetails = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const teacher = await SchoolTeacherCSV.findOne({
      _id: id,
      schoolAdmin: req.user._id
    }).select("-temporaryPassword");

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found"
      });
    }

    res.json({
      success: true,
      teacher
    });
  } catch (error) {
    console.error("Error fetching teacher details:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching teacher details"
    });
  }
});

// ✅ UPDATED: DELETE /api/school-admin/teachers/:id
const deleteTeacher = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const csvTeacher = await SchoolTeacherCSV.findOne({
      _id: id,
      schoolAdmin: req.user._id
    });

    if (!csvTeacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found"
      });
    }

    // ✅ ADD NOTIFICATION BEFORE DELETION
    await createSchoolAdminNotification(req.user._id, {
      type: "new_teacher_added",
      title: "Teacher Removed",
      message: `${csvTeacher.name} (${csvTeacher.email}) has been removed from your school`,
      data: {
        teacherName: csvTeacher.name,
        teacherEmail: csvTeacher.email,
        subject: csvTeacher.subject,
        removalDate: new Date()
      }
    });

    // ✅ ALSO delete from main Teacher if linked
    if (csvTeacher.mainUserId) {
      await Teacher.findByIdAndDelete(csvTeacher.mainUserId);
    }

    // Delete from CSV collection
    await SchoolTeacherCSV.findByIdAndDelete(id);

    // Update school admin's total teachers count
    try {
      const SchoolAdmin = require("../models/webapp-models/schoolAdminModel");
      await SchoolAdmin.findByIdAndUpdate(req.user._id, {
        $inc: { totalTeachers: -1 }
      });
    } catch (error) {
      console.error("Error updating school admin stats:", error);
    }

    res.json({
      success: true,
      message: "Teacher deleted successfully from both collections"
    });
  } catch (error) {
    console.error("Error deleting teacher:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting teacher"
    });
  }
});

module.exports = {
  bulkUploadTeachers,
  getSchoolTeachers,
  toggleTeacherStatus,
  getTeacherDetails,
  deleteTeacher
};