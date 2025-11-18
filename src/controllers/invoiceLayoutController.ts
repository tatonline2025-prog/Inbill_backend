import { Request, Response } from "express";
import invoiceLayoutModel from "../models/invoiceLayoutModel";
import mongoose from "mongoose";

// Lưu hoặc cập nhật layout
export const saveInvoiceLayout = async (req: Request, res: Response) => {
  try {
    const { layoutID, layout } = req.body;
    const user = req.user; // middleware auth đã gắn req.user (VD: { _id, username })

    if (!layout) {
      return res.status(400).json({ message: "Thiếu layout cần lưu" });
    }

    if (!user) {
      return res.status(401).json({ message: "Không xác thực được người dùng" });
    }

    console.log(layoutID, layout);

    // Tìm layout hiện có
    const existingLayout = await invoiceLayoutModel.findById({ _id: layoutID });

    if (existingLayout) {
      existingLayout.layout = layout;
      existingLayout.lastEditedBy = {
        userId: new mongoose.Types.ObjectId(user._id),
        username: user.username,
      };
      existingLayout.updatedAt = new Date();
      await existingLayout.save();

      return res.json({
        message: "Cập nhật layout thành công",
        data: existingLayout,
      });
    }
  } catch (error) {
    console.error("❌ Lỗi khi lưu layout:", error);
    return res.status(500).json({ message: "Lỗi server", error });
  }
};

export const getInvoiceLayout = async (req: Request, res: Response) => {
  try {
    const layout = await invoiceLayoutModel.find();

    // console.log(layout);

    if (!layout) {
      return res.status(404).json({ message: "Chưa có layout nào được lưu" });
    }
    return res.json(layout);
  } catch (error) {
    console.error("❌ Lỗi khi lấy layout:", error);
    return res.status(500).json({ message: "Lỗi server", error });
  }
};
