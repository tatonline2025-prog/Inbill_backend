import mongoose from "mongoose";
import { IUser } from "./userModel";

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String },
    billing_period: { type: String },
    customerAddress: { type: String, default: "" },

    // 🏙️ Thêm tỉnh (province)
    province: { type: String, default: "" },

    recordBookCode: { type: String }, // MA_SOGCS

    // 💰 Tiền kỳ này và kỳ trước
    currentAmount: { type: String, required: true }, // Tiền kỳ này
    previousAmount: { type: String, required: false }, // Tiền kỳ trước
    totalAmount: { type: String, required: true },

    isPaid: {
      type: Boolean,
      default: false,
      index: true, // Đánh index để lọc cho nhanh
    },

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
    updateBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    uploadFileId: { type: mongoose.Schema.Types.ObjectId, ref: "ExcelUpload" },

    // 📊 Thứ tự hàng trong file Excel gốc
    excelRowIndex: { type: Number, default: null },

    // 🔝 Ưu tiên sắp xếp (để đưa hóa đơn mới upload lên trên)
    sortPriority: { type: Number, default: 0 },

    note: { type: String, default: "" },
  },
  {
    timestamps: true,
  }
);

// Removed unique index to allow duplicate invoiceNumber (customer codes) across different billing periods or same period

const Invoice = mongoose.model("Invoice", invoiceSchema);

// Drop the old unique index if it exists
(async () => {
  try {
    await Invoice.collection.dropIndex("invoiceNumber_1_billing_period_1");
    console.log("Dropped old unique index");
  } catch (err: any) {
    if (err.code === 27) {
      console.log("Index already dropped or not found");
    } else {
      console.error("Error dropping index:", err);
    }
  }
})();

export default Invoice;

export interface IInvoice {
  _id: mongoose.Types.ObjectId;
  invoiceNumber: string;
  customerName: string;
  customerPhone?: string | null;
  billing_period?: string | null;
  customerAddress?: string | null;

  /** 🏙️ Tỉnh của khách hàng hoặc hóa đơn */
  province?: string | null;

  recordBookCode?: string | null;

  currentAmount: string; // 💰 Tiền kỳ này
  previousAmount?: string | null; // 💰 Tiền kỳ trước
  totalAmount: string;

  isPaid: boolean;

  collectionStatus: "collected" | "not_collected";
  printStatus: "printed" | "not_printed";
  issueDate: Date;
  collectionDate?: Date | null;
  assignedTo?: mongoose.Types.ObjectId | IUser | null;
  uploadedBy?: mongoose.Types.ObjectId | IUser | null;
  uploadFileId?: mongoose.Types.ObjectId | null;

  /** 📊 Thứ tự hàng trong file Excel gốc */
  excelRowIndex?: number | null;

  /** 🔝 Ưu tiên sắp xếp (để đưa hóa đơn mới upload lên trên) */
  sortPriority?: number | null;

  note?: string | null;
}
