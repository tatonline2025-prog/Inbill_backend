import { Request, Response } from "express";

import AreaConfig from "../models/areaConfigModel";
import {
  FREE_AREA_NAME,
  normalizeAreaName,
  normalizeAreaPrefixEntry,
  normalizePrefix,
} from "../utils/areaPrefix";

const DEFAULT_AREA_CONFIGS = [
  { area: "Lấp Vò", prefix: "PB070900" },
  { area: "Tháp Mười", prefix: "PB070700" },
  { area: "Bến Cầu", prefix: "PB050900" },
  { area: "Trảng Bàng", prefix: "PB050300" },
  { area: FREE_AREA_NAME, prefix: "" },
];

const ensureDefaultAreaConfigs = async () => {
  const count = await AreaConfig.countDocuments();
  if (count === 0) {
    await AreaConfig.insertMany(DEFAULT_AREA_CONFIGS.map((item) => ({ province: "", ...item })));
    return;
  }

  const freeArea = await AreaConfig.findOne({ area: FREE_AREA_NAME, prefix: "" }).lean();
  if (!freeArea) {
    await AreaConfig.create({ province: "", area: FREE_AREA_NAME, prefix: "" });
  }
};

export const getAllAreaConfigs = async (_req: Request, res: Response) => {
  try {
    await ensureDefaultAreaConfigs();

    const configs = await AreaConfig.find({}, { area: 1, prefix: 1, _id: 1 })
      .sort({ area: 1, prefix: 1 })
      .lean();

    return res.status(200).json({ configs });
  } catch (err) {
    console.error("getAllAreaConfigs error:", err);
    return res.status(500).json({ message: "Lỗi server khi lấy danh sách mã vùng." });
  }
};

export const createAreaConfig = async (req: Request, res: Response) => {
  try {
    const normalized = normalizeAreaPrefixEntry(req.body);
    if (!normalized) {
      return res
        .status(400)
        .json({ message: "Vui lòng nhập xã/phường hợp lệ. Prefix chỉ được để trống khi chọn Tự do." });
    }

    const existing = await AreaConfig.findOne({ area: normalized.area, prefix: normalized.prefix }).lean();
    if (existing) {
      return res.status(409).json({ message: "Khu vực này đã tồn tại." });
    }

    const doc = await AreaConfig.create({ province: "", area: normalized.area, prefix: normalized.prefix });
    return res.status(201).json({ config: doc });
  } catch (err) {
    console.error("createAreaConfig error:", err);
    return res.status(500).json({ message: "Lỗi server khi thêm mã vùng." });
  }
};

export const updateAreaConfig = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const area = normalizeAreaName(req.body?.area);
    const prefix = normalizePrefix(req.body?.prefix);

    if (!area) {
      return res.status(400).json({ message: "Xã/phường không được để trống." });
    }

    if (area !== FREE_AREA_NAME && !prefix) {
      return res.status(400).json({ message: "Prefix không được để trống, trừ khu vực Tự do." });
    }

    const nextPrefix = area === FREE_AREA_NAME ? "" : prefix;

    const existing = await AreaConfig.findById(id);
    if (!existing) {
      return res.status(404).json({ message: "Không tìm thấy khu vực." });
    }

    const conflict = await AreaConfig.findOne({
      _id: { $ne: id },
      area,
      prefix: nextPrefix,
    }).lean();
    if (conflict) {
      return res.status(409).json({ message: "Khu vực này đã tồn tại." });
    }

    existing.province = "";
    existing.area = area;
    existing.prefix = nextPrefix;
    await existing.save();

    return res.status(200).json({ config: existing });
  } catch (err) {
    console.error("updateAreaConfig error:", err);
    return res.status(500).json({ message: "Lỗi server khi cập nhật mã vùng." });
  }
};

export const deleteAreaConfig = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const doc = await AreaConfig.findById(id);
    if (!doc) {
      return res.status(404).json({ message: "Không tìm thấy khu vực." });
    }

    if (doc.area === FREE_AREA_NAME && doc.prefix === "") {
      return res.status(400).json({ message: "Không thể xóa khu vực Tự do mặc định." });
    }

    await AreaConfig.findByIdAndDelete(id);
    return res.status(200).json({ message: "Đã xóa." });
  } catch (err) {
    console.error("deleteAreaConfig error:", err);
    return res.status(500).json({ message: "Lỗi server khi xóa mã vùng." });
  }
};
