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
        id: user._id,
        role: user.role,
        username: user.username,
        fullName: user.fullName,
      },
      process.env.JWT_SECRET!,
      { expiresIn: "24h" } // Token sẽ hết hạn sau 8 tiếng
    );

    // 5. Trả về token và thông tin user (trừ password)
    res.status(200).json({
      message: "Đăng nhập thành công!",
      token,
      user: {
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Lỗi khi đăng nhập:", error);
    res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};

export const register = async (req: Request, res: Response) => {
  try {
    const { userName, email, password, fullName } = req.body;

    // --- VALIDATION ---
    if (!userName || !password || !email || !fullName) {
      return res.status(400).json({ message: "Vui lòng điền đầy đủ thông tin: username, password, fullName." });
    }

    const normalizedUsername = userName.trim().toLowerCase();
    const existingUser = await User.findOne({ username: normalizedUsername });

    if (existingUser) {
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
    createdBy = req.user.id; // Gán ID của admin đã tạo user này

    // --- CREATE USER ---
    const newUser = await User.create({
      username: normalizedUsername,
      password: hashedPassword,
      fullName,
      email,
      role,
      createdBy,
    });

    // Không trả về password trong response
    const userResponse = {
      id: newUser._id,
      username: newUser.username,
      fullName: newUser.fullName,
      role: newUser.role,
      createdAt: newUser.createdAt,
    };

    res.status(201).json({ message: "Tạo tài khoản thành công!", user: userResponse });
  } catch (error) {
    console.error("Lỗi khi đăng ký:", error);
    res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};

export const me = async (req: Request, res: Response) => {
  try {
    // req.user đã được middleware authenticate gắn vào
    // console.log(req.user);

    res.json({
      user: req.user,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};
