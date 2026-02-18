const asyncHandler = require("express-async-handler");
const AdminNotification = require("../models/webapp-models/adminNotificationModel");

// ✅ Get notifications for admin with pagination
const getAdminNotifications = asyncHandler(async (req, res) => {
  const { limit = 6, page = 1 } = req.query;
  const skip = (page - 1) * parseInt(limit);

  try {
    const notifications = await AdminNotification.find({ adminId: req.user._id }) // ✅ Changed from req.admin._id to req.user._id
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    const totalUnread = await AdminNotification.countDocuments({
      adminId: req.user._id, // ✅ Changed from req.admin._id to req.user._id
      isRead: false,
    });

    const totalNotifications = await AdminNotification.countDocuments({
      adminId: req.user._id, // ✅ Changed from req.admin._id to req.user._id
    });

    res.json({
      success: true,
      notifications,
      unreadCount: totalUnread,
      totalCount: totalNotifications,
      hasMore: notifications.length === parseInt(limit),
      currentPage: parseInt(page),
    });
  } catch (error) {
    console.error("Error fetching admin notifications:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to fetch notifications" 
    });
  }
});

// ✅ Mark single notification as read
const markNotificationAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const notification = await AdminNotification.findOneAndUpdate(
      { _id: id, adminId: req.user._id }, // ✅ Changed from req.admin._id to req.user._id
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ 
        success: false,
        message: "Notification not found" 
      });
    }

    const unreadCount = await AdminNotification.countDocuments({
      adminId: req.user._id, // ✅ Changed from req.admin._id to req.user._id
      isRead: false,
    });

    res.json({
      success: true,
      notification,
      unreadCount,
    });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to mark notification as read" 
    });
  }
});

// ✅ Mark all notifications as read
const markAllNotificationsAsRead = asyncHandler(async (req, res) => {
  try {
    await AdminNotification.updateMany(
      { adminId: req.user._id, isRead: false }, // ✅ Changed from req.admin._id to req.user._id
      { isRead: true }
    );

    const unreadCount = await AdminNotification.countDocuments({
      adminId: req.user._id, // ✅ Changed from req.admin._id to req.user._id
      isRead: false,
    });

    res.json({
      success: true,
      message: "All notifications marked as read",
      unreadCount,
    });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to mark all notifications as read" 
    });
  }
});

// ✅ Get unread notifications count only
const getUnreadNotificationsCount = asyncHandler(async (req, res) => {
  try {
    const unreadCount = await AdminNotification.countDocuments({
      adminId: req.user._id, // ✅ Changed from req.admin._id to req.user._id
      isRead: false,
    });

    res.json({
      success: true,
      unreadCount,
    });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to fetch unread count" 
    });
  }
});

// ✅ Delete a notification
const deleteNotification = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const notification = await AdminNotification.findOneAndDelete({
      _id: id,
      adminId: req.user._id, // ✅ Changed from req.admin._id to req.user._id
    });

    if (!notification) {
      return res.status(404).json({ 
        success: false,
        message: "Notification not found" 
      });
    }

    const unreadCount = await AdminNotification.countDocuments({
      adminId: req.user._id, // ✅ Changed from req.admin._id to req.user._id
      isRead: false,
    });

    res.json({
      success: true,
      message: "Notification deleted successfully",
      unreadCount,
    });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to delete notification" 
    });
  }
});

// ✅ Utility function to create notifications (for use in other controllers)
const createAdminNotification = async (adminId, notificationData) => {
  try {
    const notification = new AdminNotification({
      adminId,
      ...notificationData,
    });
    
    await notification.save();
    
    // Emit real-time event if Socket.IO is setup
    // io.to(adminId).emit('new_notification', notification);
    
    return notification;
  } catch (error) {
    console.error("Error creating admin notification:", error);
    return null;
  }
};

module.exports = {
  getAdminNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadNotificationsCount,
  deleteNotification,
  createAdminNotification,
};