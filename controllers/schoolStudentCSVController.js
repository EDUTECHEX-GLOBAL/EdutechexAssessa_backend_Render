const asyncHandler = require("express-async-handler");
const csv = require("csv-parser");
const stream = require("stream");
const SchoolStudentCSV = require("../models/webapp-models/schoolStudentCSVModel");
const Userwebapp = require("../models/webapp-models/userModel");
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

// Helper function to validate student data
const validateStudentData = (row, index) => {
  const errors = [];
  
  if (!row.name || row.name.trim().length < 2) {
    errors.push(`Row ${index}: Name is required and must be at least 2 characters`);
  }
  
  if (!row.email || !isValidEmail(row.email)) {
    errors.push(`Row ${index}: Valid email is required`);
  }
  
  if (!row.grade || !/^\d+(?:th|st|nd|rd)$/i.test(row.grade.trim())) {
    errors.push(`Row ${index}: Grade must be in format like '9th', '10th', etc.`);
  }
  
  return errors;
};

// ✅ FIXED: POST /api/school-admin/bulk-upload/students
const bulkUploadStudents = asyncHandler(async (req, res) => {
  try {
    console.log("=== CSV UPLOAD STARTED ===");
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
          const rowErrors = validateStudentData(row, rowNumber);
          
          if (rowErrors.length > 0) {
            errors.push(...rowErrors);
            failCount++;
            console.log(`❌ Row ${rowNumber} validation failed`);
            continue;
          }

          try {
            // ✅ Check if student already exists in MAIN Userwebapp
            const existingStudent = await Userwebapp.findOne({
              email: row.email.trim().toLowerCase()
            });

            if (existingStudent) {
              // UPDATE existing student instead of rejecting
              console.log(`🔄 Updating existing student: ${row.email}`);
              
              existingStudent.schoolId = schoolAdminId;
              existingStudent.schoolName = schoolAdmin.schoolName;
              existingStudent.class = row.grade.trim();
              existingStudent.mobile = row.phone?.trim() || existingStudent.mobile;
              existingStudent.city = schoolAdmin.city || existingStudent.city;
              
              const tempPassword = generatePassword();
              existingStudent.password = tempPassword;
              
              await existingStudent.save();
              
              // Find or create CSV record
              let csvStudent = await SchoolStudentCSV.findOne({
                email: row.email.trim().toLowerCase(),
                schoolAdmin: schoolAdminId
              });
              
              if (!csvStudent) {
                csvStudent = await SchoolStudentCSV.create({
                  schoolAdmin: schoolAdminId,
                  name: row.name.trim(),
                  email: row.email.trim().toLowerCase(),
                  grade: row.grade.trim(),
                  section: row.section?.trim() || "",
                  parentEmail: row.parentEmail?.trim().toLowerCase() || "",
                  phone: row.phone?.trim() || "",
                  temporaryPassword: tempPassword,
                  status: "active",
                  mainUserId: existingStudent._id,
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
                  "student"
                );
                
                emailSent = true;
                console.log(`✅ Email sent successfully to: ${row.email}`);
                
              } catch (emailError) {
                console.error(`❌ Email failed for ${row.email}:`, emailError.message);
                // Continue even if email fails
              }
              
              if (emailSent) {
                csvStudent.credentialsSent = true;
                csvStudent.credentialsSentAt = new Date();
                await csvStudent.save();
                credentialsSentCount++;
              }
              
              // ✅ ADD NOTIFICATION FOR UPDATED STUDENT
              await createSchoolAdminNotification(schoolAdminId, {
                type: "new_student_added",
                title: "Student Updated",
                message: `${row.name} (${row.email}) information has been updated`,
                data: {
                  studentId: existingStudent._id,
                  studentName: row.name,
                  studentEmail: row.email,
                  grade: row.grade,
                  status: "updated",
                  credentialsSent: emailSent
                },
                relatedUserId: existingStudent._id
              });
              
              results.push({
                name: existingStudent.name,
                email: existingStudent.email,
                grade: row.grade.trim(),
                status: "updated",
                credentialsSent: emailSent,
                mainUserId: existingStudent._id
              });
              successCount++;
              continue; // Skip to next row
            }

            // ✅ CREATE NEW STUDENT (if doesn't exist)
            const tempPassword = generatePassword();
            console.log(`🔄 Creating new user for: ${row.email}, Temp pass: ${tempPassword}`);

            // Create student in MAIN Userwebapp collection
            const student = await Userwebapp.create({
              name: row.name.trim(),
              email: row.email.trim().toLowerCase(),
              password: tempPassword,
              role: "student",
              status: "pending",
              isAdminApproved: false,
              class: row.grade.trim(),
              schoolId: schoolAdminId,
              schoolName: schoolAdmin.schoolName,
              mobile: row.phone?.trim() || "",
              city: schoolAdmin.city || "",
            });

            console.log(`✅ Created main user: ${student.email} (ID: ${student._id})`);

            // ✅ ADD NOTIFICATION FOR NEW STUDENT
            await createSchoolAdminNotification(schoolAdminId, {
              type: "new_student_added",
              title: "New Student Added",
              message: `${row.name} (${row.email}) has been added to your school`,
              data: {
                studentId: student._id,
                studentName: row.name,
                studentEmail: row.email,
                grade: row.grade,
                status: "created",
                credentialsSent: false
              },
              relatedUserId: student._id
            });

            // Create in SchoolStudentCSV for tracking
            const csvStudent = await SchoolStudentCSV.create({
              schoolAdmin: schoolAdminId,
              name: row.name.trim(),
              email: row.email.trim().toLowerCase(),
              grade: row.grade.trim(),
              section: row.section?.trim() || "",
              parentEmail: row.parentEmail?.trim().toLowerCase() || "",
              phone: row.phone?.trim() || "",
              temporaryPassword: tempPassword,
              status: "pending",
              mainUserId: student._id,
              credentialsSent: false
            });

            console.log(`✅ Created CSV record: ${csvStudent.email}`);

            // ✅ SEND EMAIL USING mailer.js sendCredentialsEmail function
            let emailSent = false;
            try {
              console.log(`📧 Sending credentials to: ${row.email}`);
              
              await sendEmail.sendCredentialsEmail(
                row.email.trim().toLowerCase(),
                row.name.trim(),
                tempPassword,
                "student"
              );
              
              emailSent = true;
              console.log(`✅ Email sent successfully to: ${row.email}`);
              
            } catch (emailError) {
              console.error(`❌ Email failed for ${row.email}:`, emailError.message);
              // Continue even if email fails
            }

            if (emailSent) {
              csvStudent.credentialsSent = true;
              csvStudent.credentialsSentAt = new Date();
              await csvStudent.save();
              credentialsSentCount++;
              
              // ✅ UPDATE NOTIFICATION WITH EMAIL STATUS
              await createSchoolAdminNotification(schoolAdminId, {
                type: "credentials_resent",
                title: "Credentials Sent",
                message: `Login credentials sent to ${row.email}`,
                data: {
                  studentId: student._id,
                  studentEmail: row.email,
                  credentialsSent: true
                },
                relatedUserId: student._id
              });
            }

            results.push({
              name: student.name,
              email: student.email,
              grade: row.grade.trim(),
              status: "created",
              credentialsSent: emailSent,
              mainUserId: student._id
            });
            successCount++;

          } catch (error) {
            console.error(`❌ Error processing row ${rowNumber}:`, error);
            errors.push(`Row ${rowNumber}: ${error.message}`);
            failCount++;
          }
        }

        // Update school admin's total students count
        if (successCount > 0) {
          try {
            await SchoolAdmin.findByIdAndUpdate(schoolAdminId, {
              $inc: { 
                totalStudents: successCount,
                activeStudents: successCount 
              }
            });
            console.log(`✅ Updated school admin stats: +${successCount} students`);
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

// ✅ UPDATED: GET /api/school-admin/students
const getSchoolStudents = asyncHandler(async (req, res) => {
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
        { grade: { $regex: search, $options: "i" } }
      ];
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get students with pagination
    const students = await SchoolStudentCSV.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select("-temporaryPassword");

    // Get total count
    const total = await SchoolStudentCSV.countDocuments(query);

    res.json({
      success: true,
      students,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error("Error fetching students:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching students"
    });
  }
});

// ✅ UPDATED: PATCH /api/school-admin/students/:id/toggle-status
const toggleStudentStatus = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const csvStudent = await SchoolStudentCSV.findOne({
      _id: id,
      schoolAdmin: req.user._id
    });

    if (!csvStudent) {
      return res.status(404).json({
        success: false,
        message: "Student not found"
      });
    }

    // ✅ ALSO update main Userwebapp if linked
    if (csvStudent.mainUserId) {
      await Userwebapp.findByIdAndUpdate(csvStudent.mainUserId, {
        status: status
      });
    }

    csvStudent.status = status;
    await csvStudent.save();

    // ✅ ADD NOTIFICATION FOR STATUS CHANGE
    await createSchoolAdminNotification(req.user._id, {
      type: status === "active" ? "student_login" : "new_student_added",
      title: `Student Status ${status === "active" ? "Activated" : "Deactivated"}`,
      message: `${csvStudent.name} (${csvStudent.email}) has been ${status === "active" ? "activated" : "deactivated"}`,
      data: {
        studentId: csvStudent._id,
        studentName: csvStudent.name,
        studentEmail: csvStudent.email,
        previousStatus: csvStudent.status,
        newStatus: status
      },
      relatedUserId: csvStudent.mainUserId
    });

    res.json({
      success: true,
      message: `Student status updated to ${status}`,
      student: {
        _id: csvStudent._id,
        name: csvStudent.name,
        email: csvStudent.email,
        status: csvStudent.status
      }
    });
  } catch (error) {
    console.error("Error toggling student status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating student status"
    });
  }
});

// GET /api/school-admin/students/:id
const getStudentDetails = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const student = await SchoolStudentCSV.findOne({
      _id: id,
      schoolAdmin: req.user._id
    }).select("-temporaryPassword");

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found"
      });
    }

    res.json({
      success: true,
      student
    });
  } catch (error) {
    console.error("Error fetching student details:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching student details"
    });
  }
});

// ✅ UPDATED: DELETE /api/school-admin/students/:id
const deleteStudent = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const csvStudent = await SchoolStudentCSV.findOne({
      _id: id,
      schoolAdmin: req.user._id
    });

    if (!csvStudent) {
      return res.status(404).json({
        success: false,
        message: "Student not found"
      });
    }

    // ✅ ADD NOTIFICATION BEFORE DELETION
    await createSchoolAdminNotification(req.user._id, {
      type: "new_student_added",
      title: "Student Removed",
      message: `${csvStudent.name} (${csvStudent.email}) has been removed from your school`,
      data: {
        studentName: csvStudent.name,
        studentEmail: csvStudent.email,
        grade: csvStudent.grade,
        removalDate: new Date()
      }
    });

    // ✅ ALSO delete from main Userwebapp if linked
    if (csvStudent.mainUserId) {
      await Userwebapp.findByIdAndDelete(csvStudent.mainUserId);
    }

    // Delete from CSV collection
    await SchoolStudentCSV.findByIdAndDelete(id);

    // Update school admin's total students count
    try {
      const SchoolAdmin = require("../models/webapp-models/schoolAdminModel");
      await SchoolAdmin.findByIdAndUpdate(req.user._id, {
        $inc: { totalStudents: -1 }
      });
    } catch (error) {
      console.error("Error updating school admin stats:", error);
    }

    res.json({
      success: true,
      message: "Student deleted successfully from both collections"
    });
  } catch (error) {
    console.error("Error deleting student:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting student"
    });
  }
});

module.exports = {
  bulkUploadStudents,
  getSchoolStudents,
  toggleStudentStatus,
  getStudentDetails,
  deleteStudent
};