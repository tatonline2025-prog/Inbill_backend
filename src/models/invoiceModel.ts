import mongoose from "mongoose";
import { IUser } from "./userModel";

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String },
    billing_period: { type: String, required: true },
    customerAddress: { type: String, default: "" },
    totalAmount: { type: String, required: true },
    previousAmount: { type: String, required: false },

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
    // Sửa đổi ở đây: tự động lấy ngày hiện tại
    issueDate: { type: Date, default: Date.now },
    // Thêm trường mới ở đây
    collectionDate: { type: Date },
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
  customerPhone?: string | null; // ✅ cho phép null
  billing_period: string;
  customerAddress?: string | null;
  totalAmount: string;
  collectionStatus: "collected" | "not_collected";
  printStatus: "printed" | "not_printed";
  issueDate: Date;
  collectionDate?: Date | null;
  assignedTo?: mongoose.Types.ObjectId | IUser | null;
  uploadedBy?: mongoose.Types.ObjectId | IUser | null;
  uploadFileId?: mongoose.Types.ObjectId | null;
}
