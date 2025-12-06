import mongoose from "mongoose";

// --- Định nghĩa Schema cho Giao dịch (Transaction) ---
const transactionSchema = new mongoose.Schema(
  {
    // Số tiền gốc của giao dịch (Decimal/Number, bắt buộc)
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Số tiền cuối cùng sau khi trừ chiết khấu (hoa hồng)
    // Trường này nên được tính toán trước khi lưu (pre-save hook) hoặc khi tạo GD
    finalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    // FK: User (CTV) đã tạo giao dịch này (Creator)
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Liên kết đến Model User
      required: true,
    },

    // FK: Loại hình giao dịch (TransactionType) được chọn
    typeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TransactionType", // Liên kết đến Model TransactionType
      required: true,
    },

    // FK: ID của Admin đã xét duyệt giao dịch (có thể NULL/null nếu chưa duyệt)
    approvedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Liên kết đến Model User
      default: null,
    },

    // FK: Ngân hàng được Admin chọn để thanh toán (có thể NULL/null nếu chưa duyệt/chưa thanh toán)
    paymentBankId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bank", // Liên kết đến Model Bank
      required: false,
      default: null,
    },

    // Trạng thái của giao dịch
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "CANCELLED"],
      default: "PENDING",
    },
  },
  {
    timestamps: true,
  }
);

// --- Tạo Model ---
const Transaction = mongoose.model("Transaction", transactionSchema);
export default Transaction;
