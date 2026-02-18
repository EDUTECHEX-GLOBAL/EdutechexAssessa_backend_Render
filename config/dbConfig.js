const mongoose = require("mongoose");
require("dotenv").config(); // Load environment variables from .env file

const connectDB = async () => {
  try {
    const mongoURL = process.env.MONGO_URI;

    console.log("📌 Loaded MONGO_URI:", mongoURL);   // <-- ADD THIS HERE

    if (!mongoURL) {
      throw new Error("MONGO_URI is not defined in the .env file");
    }

    await mongoose.connect(mongoURL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("📌 Connected DB Name:", mongoose.connection.name); // <-- ADD THIS HERE
    console.log("✅ MongoDB connection successful");
  } catch (error) {
    console.error("❌ Error connecting to MongoDB:", error.message);
    process.exit(1); // Exit process with failure
  }
};

module.exports = connectDB;
