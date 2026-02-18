// backend/utils/mailer.js
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

// Pick correct dashboard URL based on environment
const dashboardUrl =
  process.env.NODE_ENV === "production"
    ? process.env.DASHBOARD_URL_PROD
    : process.env.DASHBOARD_URL_LOCAL || "http://localhost:3000";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// Path to logo (inline in email)
const logoPath = path.join(__dirname, "assessalogo.png");
const logoExists = fs.existsSync(logoPath);

// Default basic email sender (OTP etc.)
const sendEmail = async (to, subject, text) => {
  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL,
      to,
      subject,
      text,
    });
    console.log("Email sent: " + info.response);
    return info;
  } catch (error) {
    console.error("Error sending email: ", error);
    throw new Error("Failed to send email");
  }
};

// ✅ NEW: Function specifically for sending credentials (used by CSV upload)
sendEmail.sendCredentialsEmail = async (to, name, tempPassword, role = "student") => {
  try {
    const loginUrl = role === "student" 
      ? `${dashboardUrl}/student-login`
      : `${dashboardUrl}/teacher-login`;

    const htmlMessage = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f59e0b;">Welcome to EdutechEx Assessa!</h2>
        <p>Hello ${name},</p>
        <p>Your ${role} account has been created by your school admin.</p>
        <div style="background: #fef3c7; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Login Details:</strong></p>
          <p style="margin: 5px 0;"><strong>Email:</strong> ${to}</p>
          <p style="margin: 5px 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
        </div>
        <p>Please login at <a href="${loginUrl}">${loginUrl}</a> and change your password.</p>
        <p><strong>Note:</strong> Your account needs platform admin approval before you can access all features.</p>
        <p>Best regards,<br>EdutechEx Assessa Team</p>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL,
      to,
      subject: `Welcome to EdutechEx Assessa - ${role === "student" ? "Student" : "Teacher"} Account Created`,
      html: htmlMessage,
      text: `Welcome to EdutechEx Assessa!\n\nHello ${name},\n\nYour ${role} account has been created by your school admin.\n\nLogin Details:\nEmail: ${to}\nTemporary Password: ${tempPassword}\n\nPlease login at: ${loginUrl}\n\nNote: Your account needs platform admin approval.\n\nBest regards,\nEdutechEx Assessa Team`
    });

    console.log(`✅ Credentials email sent to ${to}`);
    return true;
  } catch (error) {
    console.error(`❌ Error sending credentials email to ${to}:`, error.message);
    throw error;
  }
};

// Other existing helpers
sendEmail.sendApprovalEmail = async (to, name, role) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL,
      to,
      subject: "Your Account Has Been Approved",
      html: `<p>Dear ${name},<br>Your ${role} account has been approved.</p>`,
    });
  } catch (err) {
    console.error("Error sending approval email:", err);
    throw err;
  }
};

sendEmail.sendRejectionEmail = async (to, name, reason) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL,
      to,
      subject: "Your Account Request Has Been Rejected",
      html: `<p>Dear ${name},<br>Your account was rejected.<br>Reason: ${reason}</p>`,
    });
  } catch (err) {
    console.error("Error sending rejection email:", err);
    throw err;
  }
};

sendEmail.sendAdminStudentSignupEmail = async (name, email) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL,
      to: process.env.EMAIL,
      subject: "New Student Signup Pending Approval",
      html: `
        <h2>New Student Registration</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p>This student is waiting for your approval.</p>
        <p><a href="${dashboardUrl}/adminpanel-login">Review in Dashboard</a></p>
      `,
    });
  } catch (err) {
    console.error("Error sending student signup notification:", err);
    throw err;
  }
};

sendEmail.sendAdminTeacherSignupEmail = async (name, email) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL,
      to: process.env.EMAIL,
      subject: "New Teacher Signup Pending Approval",
      html: `
        <h2>New Teacher Registration</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p>This teacher is waiting for your approval.</p>
        <p><a href="${dashboardUrl}/adminpanel-login">Review in Dashboard</a></p>
      `,
    });
  } catch (err) {
    console.error("Error sending teacher signup notification:", err);
    throw err;
  }
};

// ==============================
// Score Report Email (inline logo + attachment)
// ==============================
sendEmail.sendScoreReportEmail = async (to, studentName, pdfBuffer, type = "standard") => {
  try {
    const subject =
      type === "sat"
        ? "🎓 Your SAT Score Report is Ready | Assessa"
        : "📊 Your Assessment Score Report is Ready | Assessa";

    // Use inline logo via cid if logo exists; otherwise omit image tag
    const logoImgTag = logoExists
      ? `<img src="cid:assessa_logo" alt="Assessa" style="width:120px; display:block; margin: 0 auto 12px;" />`
      : "";

    const htmlMessage = `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 20px auto; border:1px solid #e6e6e6; border-radius:8px; padding:24px;">
        <div style="text-align:center;">
          ${logoImgTag}
          <h2 style="color:#004D4D; font-weight:700; margin: 6px 0 10px;">${type === "sat" ? "SAT Score Report" : "Assessment Report"}</h2>
        </div>

        <p style="color:#333; line-height:1.5;">Dear <strong>${studentName || "Student"}</strong>,</p>

        <p style="color:#333; line-height:1.5;">
          Attached you'll find your <strong>${type.toUpperCase()}</strong> score report generated by Assessa. 
          The attached PDF contains a clear summary of your performance and a detailed breakdown.
        </p>

        <p style="margin-top:18px; color:#004D4D; font-weight:700;">
          Keep practicing — your growth is our mission! 🚀
        </p>

        <div style="text-align:center; margin-top:20px;">
          <a href="${dashboardUrl}/student-dashboard" style="background:#004D4D; color:#ffffff; padding:10px 18px; border-radius:6px; text-decoration:none; display:inline-block;">View Dashboard</a>
        </div>

        <hr style="margin:22px 0; border:none; border-top:1px solid #eee;" />

        <p style="font-size:12px; color:#777; text-align:center; margin:0;">
          Assessa | Smart Assessment Platform<br/>
          Need help? Contact <a href="mailto:support@assessaai.com">support@assessaai.com</a>
        </p>
      </div>
    `;

    // Build attachments: PDF + optional inline logo
    const attachments = [
      {
        filename: `${type === "sat" ? "SAT_Score_Report" : "Assessment_Score_Report"}_${Date.now()}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ];

    if (logoExists) {
      attachments.push({
        filename: "assessalogo.png",
        path: logoPath,
        cid: "assessa_logo",
      });
    }

    await transporter.sendMail({
      from: process.env.EMAIL,
      to,
      subject,
      html: htmlMessage,
      attachments,
    });

    console.log(`📧 Score report (${type}) sent to ${to}`);
  } catch (error) {
    console.error("❌ Error sending score report email:", error);
    // bubble up so callers can log, but don't crash the whole flow
    throw error;
  }
};

module.exports = sendEmail;