const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const teacherSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    pic: {
      type: String,
      required: true,
      default: "https://example.com/default-pic.png",
    },
    role: {
      type: String,
      default: "teacher", // Always teacher
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "inactive"],
      default: "pending", // Await admin approval
    },
    rejectionReason: {
      type: String,
    },
    // ✅ New fields
    className: {
      type: String,
      default: "", // optional, teacher can fill in later
    },
    selectedSubjects: {
      type: [String],
      default: [], // Array of subject names
    },
    resetPasswordToken: {
      type: String,
    },
    resetPasswordExpire: {
      type: Date,
    },
     schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SchoolAdmin",
      index: true
    },
    schoolName: {
      type: String,
      trim: true
    },
    credentialsSent: {
      type: Boolean,
      default: false
    },
    credentialsSentAt: {
      type: Date
    }

  },
  {
    timestamps: true,
  }
);

// Password hash middleware
teacherSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
teacherSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const Teacher = mongoose.model("Teacher", teacherSchema);
module.exports = Teacher;
