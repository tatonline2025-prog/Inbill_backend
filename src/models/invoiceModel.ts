import mongoose from "mongoose";

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true },
    customerName: { type: String, required: true },
    billing_period: { type: String, required: true },
    customerAddress: { type: String, default: "" },
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
