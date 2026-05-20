// src/controllers/authController.ts
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import User from "../models/userModel";
import { getJwtSecret } from "../config/env";

const isBcryptHash = (value: string): boolean => /^\$2[aby]\$\d{2}\$.{53}$/.test(value);

const normalizeUsername = (input: unknown): string => (typeof input === "string" ? input.trim().toLowerCase() : "");
const normalizePassword = (input: unknown): string => (typeof input === "string" ? input : "");
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const login = async (req: Request, res: Response) => {
  try {
    const rawUsername = req.body?.userName ?? req.body?.username;
    const normalizedUsername = normalizeUsername(rawUsername);
    const password = normalizePassword(req.body?.password);

    if (!normalizedUsername || !password) {
      return res.status(400).json({ message: "Vui long cung cap username va password." });
    }

    // Use a case-insensitive exact-match query so migrated data with mixed-case usernames can still log in.
    const user = await User.findOne({
      username: { $regex: `^${escapeRegex(normalizedUsername)}$`, $options: "i" },
    });
    if (!user) {
      return res.status(401).json({ message: "Sai tên đăng nhập hoặc mật khẩu." });
    }

    if (typeof user.password !== "string" || !isBcryptHash(user.password)) {
      console.error("Login blocked: invalid password hash format", { username: user.username });
      return res.status(401).json({ message: "Sai tên đăng nhập hoặc mật khẩu." });
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return res.status(401).json({ message: "Sai tên đăng nhập hoặc mật khẩu." });
    }

    let jwtSecret: string;
    try {
      jwtSecret = getJwtSecret();
    } catch (envError) {
      console.error("Login failed: JWT secret misconfigured", envError);
      return res.status(500).json({ message: "Server auth config is invalid (JWT_SECRET)." });
    }

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
      jwtSecret,
      { expiresIn: "24h" }
    );

    return res.status(200).json({
      message: "Dang nhap thanh cong!",
      token,
      user: {
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
    return res.status(500).json({ message: "Đã có lỗi trên máy chủ." });
  }
};

export const register = async (req: Request, res: Response) => {
  try {
    const { userName, password, fullName, province, usertype, phone, stt, areaPrefixes } = req.body;

    // --- VALIDATION ---
    if (!userName || typeof userName !== "string" || !userName.trim()) {
      return res.status(400).json({ message: "Vui lòng nhập tên đăng nhập hợp lệ." });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ message: "Mật khẩu phải có ít nhất 6 ký tự." });
    }

    if (!fullName || !province || !usertype || !stt) {
      return res
        .status(400)
        .json({ message: "Vui lòng điền đầy đủ thông tin: Họ và tên, số thứ tự, mật khẩu, tên đăng nhập,...." });
    }

    const normalizedUsername = userName.trim().toLowerCase();

    // --- HASH PASSWORD ---
    const hashedPassword = await bcrypt.hash(password, 10);

    // --- LOGIC XU LY ROLE VA CREATEDBY ---
    let role = "user";
    let createdBy = null;

    // Chi admin moi duoc quyen tao user con
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ message: "Chỉ có admin mới có quyền tạo tài khoản mới" });
    }
    createdBy = req.user._id;

    const newUser = await User.create({
      username: normalizedUsername,
      password: hashedPassword,
      fullName,
      province,
      usertype,
      role,
      phone,
      stt,
      collectionFee: 0,
      createdBy,
      areaPrefixes: Array.isArray(areaPrefixes) ? areaPrefixes : [],
    });

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

    return res.status(201).json({ message: "Tao tai khoan thanh cong!", user: userResponse });
  } catch (error) {
    console.error("Loi khi dang ky:", error);
    return res.status(500).json({ message: "Da co loi xay ra tren may chu." });
  }
};

export const me = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id;

    const user = await User.findById(userId).select("-password");

    if (!user) {
      return res.status(404).json({ message: "Khong tim thay nguoi dung" });
    }

    return res.json({ user });
  } catch (error) {
    console.error("Loi lay thong tin ca nhan:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export const changepassword = async (req: Request, res: Response) => {
  try {
    const oldPassword = normalizePassword(req.body?.oldPassword);
    const newPassword = normalizePassword(req.body?.newPassword ?? req.body?.newpass);

    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: "Ban chua dang nhap hoac token khong hop le.",
      });
    }

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        message: "Mat khau moi phai co it nhat 6 ky tu.",
      });
    }

    const userId = req.user._id;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Khong tim thay nguoi dung." });
    }

    if (oldPassword) {
      if (typeof user.password !== "string" || !isBcryptHash(user.password)) {
        return res.status(400).json({ message: "Du lieu mat khau nguoi dung khong hop le." });
      }

      const isPasswordCorrect = await bcrypt.compare(oldPassword, user.password);
      if (!isPasswordCorrect) {
        return res.status(401).json({ message: "Mat khau cu khong dung." });
      }
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;

    await user.save();

    return res.status(200).json({ message: "Doi mat khau thanh cong." });
  } catch (error) {
    console.error("Loi doi mat khau:", error);
    return res.status(500).json({ message: "Da xay ra loi khi doi mat khau." });
  }
};
