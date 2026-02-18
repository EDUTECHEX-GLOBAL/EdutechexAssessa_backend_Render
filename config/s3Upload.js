const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

// Accepts an optional folder argument for different upload types
const uploadToS3 = (file, folder = "assessments") => {
  return new Promise((resolve, reject) => {
    const fileKey = `${folder}/${uuidv4()}-${file.originalname}`;
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileKey,
      Body: file.buffer,
      ContentType: file.mimetype,
      // No ACL — keeping it private
    };

    s3.upload(params, (err, data) => {
      if (err) {
        console.error("S3 Upload Error:", err);
        reject(err);
      } else {
        resolve({ key: fileKey }); // Return key instead of public URL
      }
    });
  });
};

const getSignedUrl = (key) => {
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
    Expires: 60 * 5, // URL valid for 5 minutes
  };

  return s3.getSignedUrl("getObject", params);
};

const deleteFromS3 = (key) => {
  return new Promise((resolve, reject) => {
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
    };

    s3.deleteObject(params, (err, data) => {
      if (err) {
        console.error("S3 Delete Error:", err);
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};

module.exports = {
  uploadToS3,
  getSignedUrl,
  deleteFromS3,
};
