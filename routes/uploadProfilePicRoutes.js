const express = require("express");
const router = express.Router();
const multer = require("multer");
const { protect } = require("../middlewares/authMiddleware");
const { uploadProfilePic } = require("../controllers/profilePicController");

// Add a GET test endpoint to confirm route reachability
router.get('/test', (req, res) => {
  res.json({ message: "Upload test endpoint is working!" });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed!"), false);
  }
});

router.post(
  "/profile-pic",
  protect,
  upload.single("image"),
  (err, req, res, next) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }
    next();
  },
  uploadProfilePic
);

module.exports = router;