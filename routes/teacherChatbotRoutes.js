const express = require("express");
const router = express.Router();
const { teacherChat } = require("../controllers/teacherChatbotController");

router.post("/teacher", teacherChat);

module.exports = router;
