import mongoose from "mongoose";

const areaConfigSchema = new mongoose.Schema(
  {
    province: { type: String, required: false, trim: true, default: "" },
    area: { type: String, required: true, trim: true },
    prefix: { type: String, required: false, trim: true, default: "" },
  },
  { timestamps: true }
);

areaConfigSchema.index({ area: 1, prefix: 1 }, { unique: true });

export default mongoose.model("AreaConfig", areaConfigSchema, "areaconfigs");
