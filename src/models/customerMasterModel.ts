import mongoose from "mongoose";

/**
 * CustomerMaster - "Danh sách tổng" lưu thông tin cố định của KH (theo invoiceNumber).
 * Dùng để hỗ trợ CTV/Người phụ trách bổ sung hóa đơn kỳ mới chỉ cần điền số tiền + kỳ.
 */
const customerMasterSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, index: true },
    customerName: { type: String, default: "" },
    customerAddress: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    province: { type: String, default: "" },
    recordBookCode: { type: String, default: "" },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Số tham khảo: kỳ TT mới nhất từng có
    lastBillingPeriod: { type: String, default: "" },
    // Tổng số lần xuất hiện trong kho hóa đơn
    seenCount: { type: Number, default: 1 },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

const CustomerMaster = mongoose.model("CustomerMaster", customerMasterSchema);

export default CustomerMaster;
