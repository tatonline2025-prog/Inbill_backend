import { Request, Response } from "express";
import bcrypt from "bcryptjs";

import User from "../models/userModel";
import Invoice from "../models/invoiceModel";

export const fetchallUser = async (req: Request, res: Response) => {
  try {
    const user = await User.find({}).select("-password");

    res.status(200).json({ message: "Lấy user thành công!", user });
  } catch (error) {
    console.error("Lỗi khi lấy user:", error);
    res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};

export const changeInfo = async (req: Request, res: Response) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Bạn không có quyền thực hiện hành động này.",
    });
  }

  try {
    const { editinguserId } = req.body;
    const { fullName, email, province, username, pass, phone } = req.body.formData;

    const user = await User.findById(editinguserId);

    if (!user) return res.status(404).json({ message: "Người dùng không tồn tại" });

    user.fullName = fullName;
    user.email = email;
    user.province = province;
    user.phone = phone;

    user.username = username;

    // Mã hóa mật khẩu mới
    // Chỉ cập nhật mật khẩu nếu có thông tin mới
    if (pass && pass.trim() !== "") {
      const hashedPassword = await bcrypt.hash(pass, 10);
      user.password = hashedPassword;
    }

    await user.save();

    res.status(200).json({ message: "Thay đổi thông tin user thành công" });
  } catch (error) {
    console.error("Lỗi khi lấy user:", error);
    res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    // ✅ Kiểm tra quyền admin
    if (req.user?.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền thực hiện hành động này.",
      });
    }

    // ✅ Lấy userId từ params (nên dùng params thay vì query)
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Thiếu userId trong yêu cầu.",
      });
    }

    // ✅ Kiểm tra user có tồn tại không
    const existingUser = await User.findById(userId);
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy người dùng cần xoá.",
      });
    }

    // ✅ Tiến hành xoá
    await User.findByIdAndDelete(userId);

    await Invoice.updateMany({ assignedTo: userId }, { $set: { assignedTo: null } });

    return res.status(200).json({
      success: true,
      message: "Đã xoá tài khoản người dùng và các thông tin phụ trách liên quan thành công.",
    });
  } catch (error) {
    console.error("Lỗi khi xoá user:", error);
    return res.status(500).json({
      success: false,
      message: "Đã có lỗi xảy ra trên máy chủ.",
    });
  }
};
