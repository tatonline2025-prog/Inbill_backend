import { Request, Response } from "express";
import bcrypt from "bcryptjs";

import User from "../models/userModel";
import Invoice from "../models/invoiceModel";

export const fetchallUser = async (req: Request, res: Response) => {
  try {
    const user = await User.find({})
      .select("-password")
      .sort({ stt: 1 })
      .collation({ locale: "en_US", numericOrdering: true });

    res.status(200).json({ message: "Lấy user thành công!", user });
  } catch (error) {
    console.error("Lỗi khi lấy user:", error);
    res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};

export const changeInfo = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(403).json({
      success: false,
      message: "Không xác thực được người dùng.",
    });
  }

  try {
    const { editinguserId } = req.body;
    const { fullName, province, username, pass, phone, stt, usertype, bankAccount, bankName } = req.body.formData;

    const user = await User.findById(editinguserId);

    if (!user) return res.status(404).json({ message: "Người dùng không tồn tại" });

    user.fullName = fullName;
    user.province = province;
    user.phone = phone;
    user.stt = stt;
    user.username = username;

    if (usertype !== undefined && usertype.trim() !== "") {
      user.usertype = usertype;
    }

    if (bankAccount !== undefined) {
      user.bankAccount = bankAccount;
    }
    if (bankName !== undefined) {
      user.bankName = bankName;
    }

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

export const updateAllCollectionFee = async () => {
  try {
    // updateMany với filter {} nghĩa là chọn tất cả document trong collection
    const result = await User.updateMany({}, { $set: { collectionFee: 3000 } });
  } catch (error) {
    console.error("Lỗi khi cập nhật collectionFee:", error);
  }
};

// Backend: controllers/userController.ts
export const updateFee = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params; // Lấy ID user từ URL
    const { collectionFee } = req.body; // Lấy phí mới từ body

    // Validate
    if (collectionFee === undefined || isNaN(collectionFee)) {
      return res.status(400).json({ message: "Phí dịch vụ không hợp lệ." });
    }

    // Cập nhật Database
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { collectionFee: collectionFee },
      { new: true } // Trả về data mới sau khi update
    ).select("-password"); // Không trả về password

    res.status(200).json({ message: "Cập nhật thành công", user: updatedUser });
  } catch (error) {
    res.status(500).json({ message: "Lỗi server" });
  }
};

export const updateMissingSTT = async () => {
  try {
    const usersWithoutSTT = await User.find({
      role: "user",
      $or: [{ stt: { $exists: false } }, { stt: "" }, { stt: null }],
    });

    if (usersWithoutSTT.length === 0) {
      console.log("Tất cả người dùng (role: user) đều đã có STT.");
      return;
    }

    const existingUsers = await User.find({
      role: "user",
      stt: {
        $exists: true,
        $nin: ["", null],
      },
    }).select("stt");

    const takenSTTs = new Set(existingUsers.map((u) => u.stt).filter((n) => !isNaN(n)));

    let currentSTT = 1;

    const updatePromises = usersWithoutSTT.map((user) => {
      while (takenSTTs.has(currentSTT)) {
        currentSTT++;
      }

      const assignedSTT = currentSTT.toString();

      takenSTTs.add(currentSTT);
      currentSTT++;

      return User.updateOne({ _id: user._id }, { $set: { stt: assignedSTT } });
    });

    await Promise.all(updatePromises);

    console.log(`Đã cập nhật STT thành công cho ${usersWithoutSTT.length} user.`);
  } catch (error) {
    console.error("Lỗi khi cập nhật STT:", error);
  }
};
