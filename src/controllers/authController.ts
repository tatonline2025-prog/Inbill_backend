import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { getJwtSecret } from "../config/env";
import User from "../models/userModel";
import { ensureAreaPrefixEntries, normalizeAreaPrefixEntries } from "../utils/areaPrefix";

const isBcryptHash = (value: string): boolean => /^\$2[aby]\$\d{2}\$.{53}$/.test(value);

const normalizeUsername = (input: unknown): string => (typeof input === "string" ? input.trim().toLowerCase() : "");
const normalizePassword = (input: unknown): string => (typeof input === "string" ? input : "");
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toUserResponse = (user: any) => ({
  id: user._id,
  username: user.username,
  fullName: user.fullName,
  usertype: user.usertype,
  role: user.role,
  createdAt: user.createdAt,
  collectionFee: user.collectionFee,
  areaPrefixes: ensureAreaPrefixEntries(user.areaPrefixes),
});

export const login = async (req: Request, res: Response) => {
  try {
    const rawUsername = req.body?.userName ?? req.body?.username;
    const normalizedUsername = normalizeUsername(rawUsername);
    const password = normalizePassword(req.body?.password);

    if (!normalizedUsername || !password) {
      return res.status(400).json({ message: "Vui lòng cung cấp tên đăng nhập và mật khẩu." });
    }

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

    const normalizedAreas = ensureAreaPrefixEntries(user.areaPrefixes);

    const token = jwt.sign(
      {
        _id: user._id,
        role: user.role,
        username: user.username,
        fullName: user.fullName,
        usertype: user.usertype,
        collectionFee: user.collectionFee,
        areaPrefixes: normalizedAreas,
      },
      jwtSecret,
      { expiresIn: "24h" }
    );

    return res.status(200).json({
      message: "Đăng nhập thành công!",
      token,
      user: {
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        usertype: user.usertype,
        collectionFee: user.collectionFee,
        areaPrefixes: normalizedAreas,
      },
    });
  } catch (error) {
    console.error("Lỗi khi đăng nhập:", error);
    return res.status(500).json({ message: "Đã có lỗi trên máy chủ." });
  }
};

export const register = async (req: Request, res: Response) => {
  try {
    const { userName, password, fullName, usertype, phone, stt, areaPrefixes } = req.body;
    const normalizedAreaPrefixes = normalizeAreaPrefixEntries(areaPrefixes);

    if (!userName || typeof userName !== "string" || !userName.trim()) {
      return res.status(400).json({ message: "Vui lòng nhập tên đăng nhập hợp lệ." });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ message: "Mật khẩu phải có ít nhất 6 ký tự." });
    }

    if (!fullName || !usertype || !stt || normalizedAreaPrefixes.length === 0) {
      return res
        .status(400)
        .json({ message: "Vui lòng điền đầy đủ thông tin và chọn xã/phường từ danh sách mã vùng." });
    }

    const normalizedUsername = userName.trim().toLowerCase();
    const hashedPassword = await bcrypt.hash(password, 10);

    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ message: "Chỉ có admin mới có quyền tạo tài khoản mới." });
    }

    const newUser = await User.create({
      username: normalizedUsername,
      password: hashedPassword,
      fullName,
      province: "",
      usertype,
      role: "user",
      phone,
      stt,
      collectionFee: 0,
      createdBy: req.user._id,
      areaPrefixes: normalizedAreaPrefixes,
    });

    return res.status(201).json({ message: "Tạo tài khoản thành công!", user: toUserResponse(newUser) });
  } catch (error) {
    console.error("Lỗi khi đăng ký:", error);
    return res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};

export const me = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id;
    const user = await User.findById(userId).select("-password").lean();

    if (!user) {
      return res.status(404).json({ message: "Không tìm thấy người dùng." });
    }

    return res.json({
      user: {
        ...user,
        province: "",
        areaPrefixes: ensureAreaPrefixEntries((user as { areaPrefixes?: unknown }).areaPrefixes),
      },
    });
  } catch (error) {
    console.error("Lỗi lấy thông tin cá nhân:", error);
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
        message: "Bạn chưa đăng nhập hoặc token không hợp lệ.",
      });
    }

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        message: "Mật khẩu mới phải có ít nhất 6 ký tự.",
      });
    }

    const userId = req.user._id;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Không tìm thấy người dùng." });
    }

    if (oldPassword) {
      if (typeof user.password !== "string" || !isBcryptHash(user.password)) {
        return res.status(400).json({ message: "Dữ liệu mật khẩu người dùng không hợp lệ." });
      }

      const isPasswordCorrect = await bcrypt.compare(oldPassword, user.password);
      if (!isPasswordCorrect) {
        return res.status(401).json({ message: "Mật khẩu cũ không đúng." });
      }
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;

    await user.save();

    return res.status(200).json({ message: "Đổi mật khẩu thành công." });
  } catch (error) {
    console.error("Lỗi đổi mật khẩu:", error);
    return res.status(500).json({ message: "Đã xảy ra lỗi khi đổi mật khẩu." });
  }
};
