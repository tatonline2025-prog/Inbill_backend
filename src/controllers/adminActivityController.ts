import { Request, Response } from "express";
import mongoose from "mongoose";
import AdminActivity from "../models/adminActivityModel";

export const listAdminActivities = async (req: Request, res: Response) => {
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Chỉ admin được xem thông báo." });
  try {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20));
    const [items, total, unreadCount] = await Promise.all([
      AdminActivity.find({}).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AdminActivity.countDocuments({}), AdminActivity.countDocuments({ readBy: { $ne: req.user._id } }),
    ]);
    return res.json({ items, total, unreadCount, page, limit });
  } catch (error) {
    console.error("listAdminActivities:", error);
    return res.status(500).json({ message: "Không tải được thông báo." });
  }
};
export const markAdminActivitiesRead = async (req: Request, res: Response) => {
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Chỉ admin được cập nhật thông báo." });
  try {
    if (req.params.id === "all") {
      await AdminActivity.updateMany({ createdAt: { $lte: new Date() }, readBy: { $ne: req.user._id } }, { $addToSet: { readBy: req.user._id } });
    } else {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Thông báo không hợp lệ." });
      const item = await AdminActivity.findByIdAndUpdate(req.params.id, { $addToSet: { readBy: req.user._id } });
      if (!item) return res.status(404).json({ message: "Không tìm thấy thông báo." });
    }
    return res.json({ message: "Đã đánh dấu đã đọc." });
  } catch (error) {
    console.error("markAdminActivitiesRead:", error);
    return res.status(500).json({ message: "Không cập nhật được thông báo." });
  }
};
