const Userwebapp = require("../models/webapp-models/userModel");
const { uploadToS3, getSignedUrl } = require("../config/s3Upload");
const { v4: uuidv4 } = require("uuid");

const uploadProfilePic = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // Unique file key per user
    const fileKey = `profile-pics/${req.user._id}/${uuidv4()}-${req.file.originalname}`;
    const { key } = await uploadToS3(
      { ...req.file, originalname: fileKey },
      "profile-pics"
    );

    // Save S3 key to user's pic field
    const updatedUser = await Userwebapp.findByIdAndUpdate(
      req.user._id,
      { pic: key },
      { new: true }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate signed URL for display
    const signedUrl = getSignedUrl(key);

    res.json({
      success: true,
      url: signedUrl,
      user: updatedUser
    });
  } catch (err) {
    console.error("Profile pic upload error:", err);
    res.status(500).json({
      message: "Upload failed",
      error: process.env.NODE_ENV === "development" ? err.message : undefined
    });
  }
};

module.exports = { uploadProfilePic };
