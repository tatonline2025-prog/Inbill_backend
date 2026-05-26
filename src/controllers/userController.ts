import { Request, Response } from "express";
import bcrypt from "bcryptjs";

import Invoice from "../models/invoiceModel";
import User from "../models/userModel";
import { ensureAreaPrefixEntries, normalizeAreaPrefixEntries } from "../utils/areaPrefix";

const sanitizeUserForResponse = (user: any) => ({
  ...user,
  province: "",
  areaPrefixes: ensureAreaPrefixEntries(user.areaPrefixes),
});

export const fetchallUser = async (_req: Request, res: Response) => {
  try {
    const users = await User.find({})
      .select("-password")
      .sort({ stt: 1 })
      .collation({ locale: "en_US", numericOrdering: true })
      .lean();

    res.status(200).json({
      message: "Lấy danh sách người dùng thành công!",
      user: users.map((user) => sanitizeUserForResponse(user)),
    });
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
  if (req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Tài khoản không có quyền thực hiện thao tác này.",
    });
  }

  try {
    const { editinguserId } = req.body;
    const { fullName, username, pass, phone, stt, usertype, bankAccount, bankName, areaPrefixes } = req.body.formData;
    const normalizedAreaPrefixes = normalizeAreaPrefixEntries(areaPrefixes);

    const user = await User.findById(editinguserId);

    if (!user) {
      return res.status(404).json({ message: "Người dùng không tồn tại." });
    }

    if (typeof fullName === "string") user.fullName = fullName;
    user.province = "";
    if (typeof phone === "string") user.phone = phone;
    if (typeof stt === "number" && !Number.isNaN(stt)) user.stt = stt;
    if (typeof stt === "string" && stt.trim() !== "" && !Number.isNaN(Number(stt))) user.stt = Number(stt);
    if (typeof username === "string") user.username = username;

    if (typeof usertype === "string" && usertype.trim() !== "") {
      user.usertype = usertype;
    }

    if (bankAccount !== undefined) {
      user.bankAccount = bankAccount;
    }
    if (bankName !== undefined) {
      user.bankName = bankName;
    }

    (user as unknown as { areaPrefixes: { area: string; prefix: string }[] }).areaPrefixes =
      normalizedAreaPrefixes.length > 0 ? normalizedAreaPrefixes : ensureAreaPrefixEntries([]);

    if (typeof pass === "string" && pass.trim() !== "") {
      const hashedPassword = await bcrypt.hash(pass, 10);
      user.password = hashedPassword;
    }

    await user.save();

    res.status(200).json({ message: "Thay đổi thông tin người dùng thành công." });
  } catch (error) {
    console.error("Lỗi khi cập nhật user:", error);
    res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};

export const changeMyInfo = async (req: Request, res: Response) => {
  if (!req.user?._id) {
    return res.status(401).json({
      success: false,
      message: "Không xác thực được người dùng.",
    });
  }

  try {
    const { fullName, username, pass, phone, bankAccount, bankName, areaPrefixes } = req.body.formData || {};
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: "Người dùng không tồn tại." });
    }

    if (typeof fullName === "string") user.fullName = fullName;
    user.province = "";
    if (typeof phone === "string") user.phone = phone;
    if (typeof username === "string") user.username = username;
    if (typeof bankAccount === "string") user.bankAccount = bankAccount;
    if (typeof bankName === "string") user.bankName = bankName;

    const normalizedAreaPrefixes = normalizeAreaPrefixEntries(areaPrefixes);
    (user as unknown as { areaPrefixes: { area: string; prefix: string }[] }).areaPrefixes =
      normalizedAreaPrefixes.length > 0 ? normalizedAreaPrefixes : ensureAreaPrefixEntries([]);

    if (typeof pass === "string" && pass.trim() !== "") {
      const hashedPassword = await bcrypt.hash(pass, 10);
      user.password = hashedPassword;
    }

    await user.save();
    return res.status(200).json({ message: "Cập nhật thông tin cá nhân thành công." });
  } catch (error) {
    console.error("Lỗi khi cập nhật thông tin cá nhân:", error);
    return res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền thực hiện hành động này.",
      });
    }

    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Thiếu userId trong yêu cầu.",
      });
    }

    const existingUser = await User.findById(userId);
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy người dùng cần xoá.",
      });
    }

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
    await User.updateMany({}, { $set: { collectionFee: 3000 } });
  } catch (error) {
    console.error("Lỗi khi cập nhật collectionFee:", error);
  }
};

export const updateFee = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: "Không xác thực được người dùng." });
  }

  try {
    const { userId } = req.params;
    const { collectionFee } = req.body;

    if (req.user.role !== "admin" && req.user._id !== userId) {
      return res.status(403).json({ message: "Tài khoản không có quyền thực hiện thao tác này." });
    }

    const normalizedFee = Number(collectionFee);
    if (collectionFee === undefined || Number.isNaN(normalizedFee) || normalizedFee < 0) {
      return res.status(400).json({ message: "Phí dịch vụ không hợp lệ." });
    }

    const updatedUser = await User.findByIdAndUpdate(userId, { collectionFee: normalizedFee }, { new: true })
      .select("-password")
      .lean();

    if (!updatedUser) {
      return res.status(404).json({ message: "Người dùng không tồn tại." });
    }

    return res.status(200).json({
      message: "Cập nhật thành công",
      user: sanitizeUserForResponse(updatedUser),
    });
  } catch (error) {
    console.error("updateFee error:", error);
    return res.status(500).json({ message: "Lỗi server" });
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
