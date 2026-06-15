import mongoose from "mongoose";

const channelStatusEnum = ["pending", "sending", "sent", "failed"] as const;

const deliveryActorSchema = new mongoose.Schema(
  {
    userId: { type: String, default: "" },
    fullName: { type: String, default: "" },
    username: { type: String, default: "" },
    role: { type: String, default: "" },
  },
  { _id: false }
);

const collectionDeliveryLogSchema = new mongoose.Schema(
  {
    eventKey: { type: String, required: true, unique: true, index: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", default: null, index: true },
    invoiceNumber: { type: String, required: true, index: true },
    billingPeriod: { type: String, default: "", index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    assignedToName: { type: String, default: "" },
    collectionDate: { type: Date, default: null, index: true },
    collectionDateDisplay: { type: String, default: "" },
    totalAmountValue: { type: Number, default: 0 },
    source: { type: String, default: "" },
    actor: { type: deliveryActorSchema, default: () => ({}) },
    telegramStatus: { type: String, enum: channelStatusEnum, default: "pending", index: true },
    telegramSentAt: { type: Date, default: null },
    telegramError: { type: String, default: "" },
    telegramLockExpiresAt: { type: Date, default: null },
    webhookStatus: { type: String, enum: channelStatusEnum, default: "pending", index: true },
    webhookSentAt: { type: Date, default: null },
    webhookError: { type: String, default: "" },
    webhookLockExpiresAt: { type: Date, default: null },
    lastAttemptAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

collectionDeliveryLogSchema.index({ collectionDate: 1, invoiceNumber: 1 });

const CollectionDeliveryLog = mongoose.model("CollectionDeliveryLog", collectionDeliveryLogSchema);

export default CollectionDeliveryLog;
