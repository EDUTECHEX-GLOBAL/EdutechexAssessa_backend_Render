const express = require("express");
const router = express.Router();
const { studentChat } = require("../controllers/chatbotcontroller");

router.post("/student", studentChat);

module.exports = router;
