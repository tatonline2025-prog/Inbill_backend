import mongoose from "mongoose";

// Mỗi document = 1 khu vực/xã/phường thuộc 1 tỉnh
// Ví dụ: { province: "Đồng Tháp", area: "Lấp Vò", prefix: "PB070900" }
const areaConfigSchema = new mongoose.Schema(
  {
    province: { type: String, required: true, trim: true },
    area: { type: String, required: true, trim: true },
    prefix: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

// Unique: mỗi cặp province+area chỉ có 1 prefix
areaConfigSchema.index({ province: 1, area: 1 }, { unique: true });

export default mongoose.model("AreaConfig", areaConfigSchema, "areaconfigs");
