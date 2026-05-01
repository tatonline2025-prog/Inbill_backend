import { Request, Response } from "express";
import AreaConfig from "../models/areaConfigModel";

// Dữ liệu mặc định để seed lần đầu nếu collection rỗng
const DEFAULT_AREA_CONFIGS = [
  { province: "Đồng Tháp", area: "Lấp Vò", prefix: "PB070900" },
  { province: "Đồng Tháp", area: "ĐT Mười", prefix: "PB070700" },
  { province: "Tây Ninh", area: "Bến Cầu", prefix: "PB050900" },
  { province: "Tây Ninh", area: "Trảng Bàng", prefix: "PB050300" },
];

// GET /api/area-config — trả về toàn bộ danh sách, nhóm theo tỉnh
export const getAllAreaConfigs = async (_req: Request, res: Response) => {
  try {
    // Nếu collection rỗng → seed dữ liệu mặc định
    const count = await AreaConfig.countDocuments();
    if (count === 0) {
      await AreaConfig.insertMany(DEFAULT_AREA_CONFIGS);
    }

    const configs = await AreaConfig.find({}, { province: 1, area: 1, prefix: 1, _id: 1 }).sort({ province: 1, area: 1 });
    return res.status(200).json({ configs });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

// POST /api/area-config — thêm mới 1 khu vực
export const createAreaConfig = async (req: Request, res: Response) => {
  try {
    const { province, area, prefix } = req.body;
    if (!province || !area || !prefix) {
      return res.status(400).json({ message: "Thiếu province, area hoặc prefix" });
    }

    const existing = await AreaConfig.findOne({ province: province.trim(), area: area.trim() });
    if (existing) {
      return res.status(409).json({ message: "Khu vực này đã tồn tại trong tỉnh đó" });
    }

    const doc = await AreaConfig.create({ province: province.trim(), area: area.trim(), prefix: prefix.trim() });
    return res.status(201).json({ config: doc });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

// PUT /api/area-config/:id — cập nhật prefix (hoặc area)
export const updateAreaConfig = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { area, prefix } = req.body;

    const doc = await AreaConfig.findByIdAndUpdate(
      id,
      { ...(area && { area: area.trim() }), ...(prefix && { prefix: prefix.trim() }) },
      { new: true }
    );

    if (!doc) return res.status(404).json({ message: "Không tìm thấy khu vực" });
    return res.status(200).json({ config: doc });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

// DELETE /api/area-config/:id — xoá 1 khu vực
export const deleteAreaConfig = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const doc = await AreaConfig.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ message: "Không tìm thấy khu vực" });
    return res.status(200).json({ message: "Đã xoá" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Lỗi server" });
  }
};
