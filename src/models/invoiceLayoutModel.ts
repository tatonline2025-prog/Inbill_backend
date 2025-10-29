// models/InvoiceLayout.ts
import mongoose from "mongoose";

const InvoiceLayoutSchema = new mongoose.Schema({
  layout: { type: Array, required: true },
  lastEditedBy: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    username: { type: String },
  },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("InvoiceLayout", InvoiceLayoutSchema);
