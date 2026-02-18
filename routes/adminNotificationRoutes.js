const express = require("express");
const router = express.Router();
const {
  getAdminNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadNotificationsCount,
  deleteNotification,
} = require("../controllers/adminNotificationController");
const { protect, admin } = require("../middlewares/authMiddleware"); // ✅ Fix path to "middlewares"

// Apply admin protection to all routes
router.use(protect);
router.use(admin); // ✅ Add admin middleware to ensure only admins can access

// GET /api/admin/notifications - Get notifications with pagination
router.get("/", getAdminNotifications);

// GET /api/admin/notifications/unread-count - Get unread count
router.get("/unread-count", getUnreadNotificationsCount);

// PATCH /api/admin/notifications/:id/read - Mark single notification as read
router.patch("/:id/read", markNotificationAsRead);

// PATCH /api/admin/notifications/mark-all-read - Mark all as read
router.patch("/mark-all-read", markAllNotificationsAsRead);

// DELETE /api/admin/notifications/:id - Delete a notification
router.delete("/:id", deleteNotification);

module.exports = router;