const sendEmail = require("../utils/mailer");
const ForgotPassword = require("../models/webapp-models/teacher_forgotpassword_model");
const Teacher = require("../models/webapp-models/teacherModel"); // Teacher model for updating the password
const bcrypt = require("bcryptjs");

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

exports.sendOTP = async (req, res) => {
    try {
        const { email } = req.body;

        // Check if the teacher exists
        const teacher = await Teacher.findOne({ email });
        if (!teacher) return res.status(404).json({ message: "User not found" });

        const otp = generateOTP();
        const otpExpires = Date.now() + 10 * 60 * 1000; // OTP valid for 10 minutes

        console.log("Generated OTP:", otp);
        console.log("Storing OTP for email:", email);

        // Store OTP in the ForgotPassword collection
        const result = await ForgotPassword.findOneAndUpdate(
            { email },
            { otp, otpExpires },
            { upsert: true, new: true }
        );

        console.log("OTP stored result:", result);

        // Send OTP via email
        await sendEmail(
            email,
            "Password Reset Request",
            `Hello,\n\nYour OTP for password reset is ${otp}. It is valid for 10 minutes.\n\nThank you!`
        );

        res.json({ message: "OTP sent successfully" });
    } catch (error) {
        console.error("Error sending OTP:", error);
        res.status(500).json({ message: "Internal Server Error", error });
    }
};

exports.verifyOTP = async (req, res) => {
    try {
        const { email, otp } = req.body;
        const record = await ForgotPassword.findOne({ email });

        if (!record || record.otp !== otp || record.otpExpires < Date.now()) {
            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        res.json({ message: "OTP verified successfully" });
    } catch (error) {
        console.error("Error verifying OTP:", error);
        res.status(500).json({ message: "Internal Server Error", error });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const record = await ForgotPassword.findOne({ email });

        if (!record || record.otp !== otp || record.otpExpires < Date.now()) {
            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update the teacher's password
        await Teacher.findOneAndUpdate({ email }, { password: hashedPassword });

        // Delete OTP record after successful reset
        await ForgotPassword.deleteOne({ email });

        res.json({ message: "Password reset successful" });
    } catch (error) {
        console.error("Error resetting password:", error);
        res.status(500).json({ message: "Internal Server Error", error });
    }
};
