import { Request, Response } from "express";

import User from "../models/userModel";

export const fetchallUser = async (req: Request, res: Response) => {
  try {
    const user = await User.find({});

    res.status(200).json({ message: "Lấy user thành công!", user });
  } catch (error) {
    console.error("Lỗi khi lấy user:", error);
    res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};
