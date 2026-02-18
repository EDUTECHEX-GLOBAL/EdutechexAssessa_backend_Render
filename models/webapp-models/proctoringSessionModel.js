const mongoose = require("mongoose");

const violationSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: [
      'tab_switch',
      'right_click', 
      'keyboard_shortcut',
      'page_leave_attempt',
      'camera_disabled',
      'microphone_disabled',
      'multiple_faces',
      'no_face_detected',
      'fullscreen_exit',
      'fullscreen_exit_attempt',
      'fullscreen_failed',
      'suspicious_audio_level',
      'face_not_detected',
      'developer_tools_attempt',
      'escape_attempt',
      'low_light_condition',
      'user_quit_test'
    ] // Added all missing enum values
  },
  timestamp: { type: Date, default: Date.now },
  details: { type: mongoose.Schema.Types.Mixed }
});

const proctoringSessionSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Userwebapp",
    required: true
  },
  assessmentId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  assessmentType: {
    type: String,
    enum: ['standard', 'sat'],
    required: true
  },
  mode: {
    type: String,
    enum: ['test', 'real'],
    required: true
  },
  startTime: { type: Date, default: Date.now },
  endTime: { type: Date },
  status: {
    type: String,
    enum: ['active', 'completed', 'terminated'],
    default: 'active'
  },
  violations: [violationSchema],
  violationCount: { type: Number, default: 0 },
  linkedSubmissionId: { type: mongoose.Schema.Types.ObjectId }, // Links to actual submission
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("ProctoringSession", proctoringSessionSchema);