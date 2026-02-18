const asyncHandler = require("express-async-handler");
const SchoolAdminNotification = require("../models/webapp-models/schoolAdminNotificationModel");
const SchoolAdmin = require("../models/webapp-models/schoolAdminModel");

// Helper function to create notifications (used by other controllers)
const createSchoolAdminNotification = async (schoolAdminId, notificationData) => {
  try {
    const notification = await SchoolAdminNotification.create({
      schoolAdminId,
      ...notificationData,
      read: false
    });
    
    // Increment unread count in SchoolAdmin model
    await SchoolAdmin.findByIdAndUpdate(schoolAdminId, {
      $inc: { unreadNotifications: 1 }
    });
    
    return notification;
  } catch (error) {
    console.error("Error creating school admin notification:", error);
    return null;
  }
};

// Get notifications for school admin
const getSchoolAdminNotifications = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false, type } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const query = { schoolAdminId: req.user._id };
    
    if (unreadOnly === "true") query.read = false;
    if (type && type !== "all") query.type = type;
    
    const notifications = await SchoolAdminNotification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await SchoolAdminNotification.countDocuments(query);
    const unreadCount = await SchoolAdminNotification.countDocuments({
      schoolAdminId: req.user._id,
      read: false
    });
    
    res.json({
      success: true,
      notifications,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      },
      unreadCount
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications"
    });
  }
});

// Mark notification as read
const markNotificationAsRead = asyncHandler(async (req, res) => {
  try {
    const notification = await SchoolAdminNotification.findOne({
      _id: req.params.id,
      schoolAdminId: req.user._id
    });
    
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }
    
    if (!notification.read) {
      notification.read = true;
      await notification.save();
      
      // Decrement unread count
      await SchoolAdmin.findByIdAndUpdate(req.user._id, {
        $inc: { unreadNotifications: -1 }
      });
    }
    
    res.json({
      success: true,
      message: "Notification marked as read"
    });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notification as read"
    });
  }
});

// Mark all notifications as read
const markAllAsRead = asyncHandler(async (req, res) => {
  try {
    const result = await SchoolAdminNotification.updateMany(
      { schoolAdminId: req.user._id, read: false },
      { read: true }
    );
    
    if (result.modifiedCount > 0) {
      // Reset unread count to 0
      await SchoolAdmin.findByIdAndUpdate(req.user._id, {
        unreadNotifications: 0
      });
    }
    
    res.json({
      success: true,
      message: `Marked ${result.modifiedCount} notifications as read`
    });
  } catch (error) {
    console.error("Error marking all as read:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark all notifications as read"
    });
  }
});

// Get unread notification count
const getUnreadCount = asyncHandler(async (req, res) => {
  try {
    const schoolAdmin = await SchoolAdmin.findById(req.user._id).select("unreadNotifications");
    
    res.json({
      success: true,
      unreadCount: schoolAdmin.unreadNotifications || 0
    });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch unread count"
    });
  }
});

module.exports = {
  createSchoolAdminNotification,
  getSchoolAdminNotifications,
  markNotificationAsRead,
  markAllAsRead,
  getUnreadCount
};