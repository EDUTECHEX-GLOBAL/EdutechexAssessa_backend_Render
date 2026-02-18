const express = require("express");
const multer = require("multer");
const router = express.Router();

const {
  registerTeacher,
  authTeacher,
  getTeacherProfile,
  updateTeacherProfile,
} = require("../controllers/teacherController");

const { protect } = require("../middlewares/authMiddleware");
const { uploadToS3 } = require("../config/s3Upload");

// Multer in-memory storage
const upload = multer({ storage: multer.memoryStorage() });

const { getSignedUrl } = require("../config/s3Upload");

router.post("/register", registerTeacher);
router.post("/login", authTeacher);

// Fetch profile
router.get("/profile", protect, getTeacherProfile);

// Update profile
router.put("/profile", protect, updateTeacherProfile);

// Upload profile picture
router.post("/upload-pic", protect, upload.single("pic"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file provided" });

    const result = await uploadToS3(req.file, "teacher-profiles");
    const signedUrl = getSignedUrl(result.key);

    res.json({
      key: result.key,
      url: signedUrl,   // ✅ frontend uses this directly
    });
  } catch (err) {
    console.error("Teacher pic upload error:", err);
    res.status(500).json({ message: "Error uploading file" });
  }
});

module.exports = router;
