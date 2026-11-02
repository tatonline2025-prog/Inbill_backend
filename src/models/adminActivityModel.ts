import mongoose from "mongoose";

const adminActivitySchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  actorName: { type: String, required: true },
  actorUsername: { type: String, default: "" },
  action: { type: String, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
  customerCode: { type: String, default: "" },
  count: { type: Number, default: 1 },
  changes: { type: [{ field: String, label: String, before: String, after: String }], default: [] },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  readBy: { type: [mongoose.Schema.Types.ObjectId], ref: "User", default: [] },
  telegramStatus: { type: String, enum: ["not_requested", "awaiting_config", "pending", "sending", "sent", "failed"], default: "not_requested" },
  telegramAttempts: { type: Number, default: 0 },
  telegramNextAttemptAt: { type: Date, default: Date.now },
  telegramLockedUntil: { type: Date, default: null },
  telegramSentAt: { type: Date, default: null },
  telegramMessageId: { type: Number, default: null },
  telegramError: { type: String, default: "" },
}, { timestamps: true });
adminActivitySchema.index({ createdAt: -1, _id: -1 });
adminActivitySchema.index({ readBy: 1, createdAt: -1 });
adminActivitySchema.index({ telegramStatus: 1, telegramNextAttemptAt: 1 });
export default mongoose.model("AdminActivity", adminActivitySchema);
