// src/controllers/authController.ts
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import User from "../models/userModel";

export const login = async (req: Request, res: Response) => {
  try {
    // 1. Lấy username và password từ body
    const { userName, password } = req.body;
    if (!userName || !password) {
      return res.status(400).json({ message: "Vui lòng cung cấp username và password." });
    }

    // 2. Tìm user trong database
    const normalizedUsername = userName.trim().toLowerCase();
    const user = await User.findOne({ username: normalizedUsername });

    // Dùng thông báo chung để tránh lộ thông tin username có tồn tại hay không
    if (!user) {
      return res.status(401).json({ message: "Sai tên đăng nhập hoặc mật khẩu." });
    }

    // 3. So sánh mật khẩu người dùng gửi lên với mật khẩu đã hash trong DB
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return res.status(401).json({ message: "Sai tên đăng nhập hoặc mật khẩu." });
    }

    // 4. Ký và tạo token
    const token = jwt.sign(
      {
        _id: user._id,
        role: user.role,
        username: user.username,
        fullName: user.fullName,
        province: user.province,
        usertype: user.usertype,
        collectionFee: user.collectionFee,
      },
      process.env.JWT_SECRET!,
      { expiresIn: "24h" } // Token sẽ hết hạn sau 8 tiếng
    );

    // 5. Trả về token và thông tin user (trừ password)
    res.status(200).json({
      message: "Đăng nhập thành công!",
      token,
      user: {
        // _id: user._id,
        username: user.username,
        fullName: user.fullName,
        province: user.province,
        role: user.role,
        usertype: user.usertype,
        collectionFee: user.collectionFee,
      },
    });
  } catch (error) {
    console.error("Lỗi khi đăng nhập:", error);
    res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};

export const register = async (req: Request, res: Response) => {
  try {
    const { userName, email, password, fullName, province, usertype } = req.body;

    // --- VALIDATION ---
    if (!userName || !password || !email || !fullName || !province || !usertype) {
      return res.status(400).json({ message: "Vui lòng điền đầy đủ thông tin: username, password, fullName." });
    }

    const normalizedUsername = userName.trim().toLowerCase();
    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({ $or: [{ username: normalizedUsername }, { email: normalizedEmail }] });

    if (existingUser) {
      if (email === existingUser.email) {
        return res.status(400).json({ message: "Email này đã được sử dụng." });
      }

      return res.status(400).json({ message: "Username này đã được sử dụng." });
    }

    // --- HASH PASSWORD ---
    const hashedPassword = await bcrypt.hash(password, 10);

    // --- LOGIC XỬ LÝ ROLE VÀ CREATEDBY ---
    let role = "user";
    let createdBy = null;

    // Chỉ admin mới được quyền tạo user con
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ message: "Chỉ admin mới có quyền tạo tài khoản mới." });
    }
    createdBy = req.user._id; // Gán ID của admin đã tạo user này

    // --- CREATE USER ---
    const newUser = await User.create({
      username: normalizedUsername,
      password: hashedPassword,
      fullName,
      email,
      province,
      usertype,
      role,
      collectionFee: 0,
      createdBy,
    });

    // Không trả về password trong response
    const userResponse = {
      id: newUser._id,
      username: newUser.username,
      fullName: newUser.fullName,
      province: newUser.province,
      usertype: newUser.usertype,
      role: newUser.role,
      createdAt: newUser.createdAt,
      collectionFee: newUser.collectionFee,
    };

    res.status(201).json({ message: "Tạo tài khoản thành công!", user: userResponse });
  } catch (error) {
    console.error("Lỗi khi đăng ký:", error);
    res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};

export const me = async (req: Request, res: Response) => {
  try {
    // 1. Lấy ID từ req.user (đã được middleware giải mã từ token)
    // Lưu ý: tùy middleware mà nó là req.user._id hoặc req.user.id
    const userId = req.user?._id;

    // 2. Truy vấn trực tiếp vào Database để lấy dữ liệu TƯƠI MỚI nhất
    const user = await User.findById(userId).select("-password"); // Loại bỏ pass cho an toàn

    if (!user) {
      return res.status(404).json({ message: "Không tìm thấy người dùng" });
    }

    // 3. Trả về user mới (Lúc này collectionFee chắc chắn là số mới update)
    res.json({
      user: user,
    });
  } catch (error) {
    console.error("Lỗi lấy thông tin cá nhân:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const changepassword = async (req: Request, res: Response) => {
  try {
    const { newpass } = req.body;

    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: "Bạn chưa đăng nhập hoặc token không hợp lệ.",
      });
    }

    const userId = req.user._id;
    // Tìm user hiện tại trong database
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Không tìm thấy người dùng." });
    }

    // Mã hóa mật khẩu mới
    const hashedPassword = await bcrypt.hash(newpass, 10);
    user.password = hashedPassword;

    await user.save();

    return res.status(200).json({ message: "Đổi mật khẩu thành công." });
  } catch (error) {
    console.error("Lỗi đổi mật khẩu:", error);
    return res.status(500).json({ message: "Đã xảy ra lỗi khi đổi mật khẩu." });
  }
};
