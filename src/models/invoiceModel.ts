import mongoose from "mongoose";
import { IUser } from "./userModel";

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String },
    billing_period: { type: String, required: true },
    customerAddress: { type: String, default: "" },

    // 💰 Tiền kỳ này và kỳ trước
    currentAmount: { type: String, required: true }, // Tiền kỳ này
    previousAmount: { type: String, required: false }, // Tiền kỳ trước

    totalAmount: { type: String, required: true },

    collectionStatus: {
      type: String,
      enum: ["collected", "not_collected"],
      default: "not_collected",
    },
    printStatus: {
      type: String,
      enum: ["printed", "not_printed"],
      default: "not_printed",
    },

    // 🗓 Ngày phát hành & ngày thu tiền
    issueDate: { type: Date, default: Date.now },
    collectionDate: { type: Date },

    // 👥 Người xử lý
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    uploadFileId: { type: mongoose.Schema.Types.ObjectId, ref: "ExcelUpload" },
  },
  {
    timestamps: true,
  }
);

invoiceSchema.index({ invoiceNumber: 1, billing_period: 1 }, { unique: true });

const Invoice = mongoose.model("Invoice", invoiceSchema);
export default Invoice;

export interface IInvoice {
  _id: mongoose.Types.ObjectId;
  invoiceNumber: string;
  customerName: string;
  customerPhone?: string | null;
  billing_period: string;
  customerAddress?: string | null;
  currentAmount: string; // 💰 Tiền kỳ này
  previousAmount?: string | null; // 💰 Tiền kỳ trước
  totalAmount: string;
  collectionStatus: "collected" | "not_collected";
  printStatus: "printed" | "not_printed";
  issueDate: Date;
  collectionDate?: Date | null;
  assignedTo?: mongoose.Types.ObjectId | IUser | null;
  uploadedBy?: mongoose.Types.ObjectId | IUser | null;
  uploadFileId?: mongoose.Types.ObjectId | null;
}
