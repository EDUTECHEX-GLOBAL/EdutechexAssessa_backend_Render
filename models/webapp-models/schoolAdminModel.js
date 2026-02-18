const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const schoolAdminSchema = new mongoose.Schema(
  {
    schoolId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    schoolName: {
      type: String,
      required: [true, "School name is required"],
      trim: true,
    },
    city: {
      type: String,
      required: [true, "City is required"],
      trim: true,
    },
    state: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    pincode: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
    },
    contactNumber: {
      type: String,
      trim: true,
    },
    principalName: {
      type: String,
      trim: true,
    },
    website: {
      type: String,
      trim: true,
    },
    establishedYear: {
      type: String,
      trim: true,
    },
    schoolType: {
      type: String,
      enum: ["Private", "Government", "Aided", "International", "Public", "Semi-Private"],
      default: "Private",
    },
    boardAffiliation: {
      type: String,
      enum: ["CBSE", "ICSE", "State Board", "IB", "IGCSE", "Other"],
      default: "CBSE",
    },
    password: {
      type: String,
      required: [true, "Password is required"],
    },
    role: {
      type: String,
      default: "schoolAdmin",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "inactive"],
      default: "pending",
    },
    isAdminApproved: {
      type: Boolean,
      default: false,
    },
    rejectionReason: {
      type: String,
    },
    resetOtpCode: {
      type: String,
    },
    resetOtpExpire: {
      type: Date,
    },
    schoolCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    totalStudents: {
      type: Number,
      default: 0,
    },
    totalTeachers: {
      type: Number,
      default: 0,
    },
    activeStudents: {
      type: Number,
      default: 0,
    },
    activeTeachers: {
      type: Number,
      default: 0,
    },
    classes: {
      type: [Number],
      default: [9, 10, 11, 12],
    },
    streams: {
      type: [String],
      default: ["Science", "Commerce", "Arts"],
    },
    subscriptionPlan: {
      type: String,
      enum: ["Free", "Basic", "Premium", "Enterprise"],
      default: "Free",
    },
    subscriptionExpiry: {
      type: Date,
    },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "rejected", "under_review"],
      default: "pending",
    },
    registrationDate: {
      type: Date,
      default: Date.now,
    },
    lastUpdated: {
      type: Date,
    },
    unreadNotifications: {
      type: Number,
      default: 0
    },
  },
  { timestamps: true }
);

// Hash password before save
schoolAdminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Update lastUpdated timestamp
schoolAdminSchema.pre("save", function (next) {
  if (this.isModified()) {
    this.lastUpdated = Date.now();
  }
  next();
});

// Generate schoolId if not present
schoolAdminSchema.pre("save", function (next) {
  if (!this.schoolId && this.schoolName) {
    const namePart = this.schoolName
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, 4)
      .toUpperCase();
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    this.schoolId = `${namePart}${randomPart}`;
  }
  next();
});

// Generate school code
schoolAdminSchema.pre("save", async function (next) {
  if (!this.schoolCode && this.schoolName) {
    const prefix = this.schoolName.substring(0, 3).toUpperCase();
    const random = Math.floor(1000 + Math.random() * 9000);
    this.schoolCode = `${prefix}${random}`;
  }
  next();
});

// Compare password
schoolAdminSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Method to get public profile data
schoolAdminSchema.methods.toProfileJSON = function () {
  return {
    _id: this._id,
    schoolId: this.schoolId,
    schoolName: this.schoolName,
    schoolCode: this.schoolCode,
    address: this.address,
    city: this.city,
    state: this.state,
    pincode: this.pincode,
    email: this.email,
    contactNumber: this.contactNumber,
    principalName: this.principalName,
    website: this.website,
    establishedYear: this.establishedYear,
    schoolType: this.schoolType,
    boardAffiliation: this.boardAffiliation,
    totalStudents: this.totalStudents,
    totalTeachers: this.totalTeachers,
    activeStudents: this.activeStudents,
    activeTeachers: this.activeTeachers,
    classes: this.classes,
    streams: this.streams,
    subscriptionPlan: this.subscriptionPlan,
    subscriptionExpiry: this.subscriptionExpiry,
    status: this.status,
    verificationStatus: this.verificationStatus,
    registrationDate: this.registrationDate,
    lastUpdated: this.lastUpdated,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

const SchoolAdmin = mongoose.model("SchoolAdmin", schoolAdminSchema);
module.exports = SchoolAdmin;