import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    // --- Phần User (CTV) nhập liệu ---

    // Số tiền giao dịch
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    // % Chiết khấu (User tự điền theo yêu cầu)
    discountPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100, // Không thể quá 100%
      default: 0,
    },

    // Số tiền thực nhận: Sẽ được tính tự động (Amount - Discount)
    finalAmount: {
      type: Number,
      required: true, // Vẫn required nhưng sẽ tính ở pre-save
    },

    // Loại hình giao dịch (Chọn từ danh sách Admin tạo)
    typeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TransactionType",
      required: true,
    },

    // User tạo giao dịch (CTV)
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Ghi chú của User (nếu có)
    note: {
      type: String,
      default: "",
    },

    // --- Phần Admin xử lý ---

    // Trạng thái giao dịch
    // PENDING: Chờ duyệt (User có thể sửa/xóa)
    // PAID: Đã thanh toán (Admin đã duyệt và chuyển tiền -> User không được sửa)
    // REJECTED: Từ chối (Giao dịch sai thông tin)
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "CANCELLED"],
      default: "PENDING",
    },

    // Admin nào đã duyệt
    approvedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Nguồn tiền thanh toán (Admin chọn Bank của công ty để chuyển khoản)
    // Tham chiếu đến model SystemBank (xem bên dưới)
    paymentSourceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bank",
      default: null,
    },

    // Thời gian Admin duyệt/thanh toán
    paidAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true, // Tạo createdAt (ngày tạo lệnh) và updatedAt
  }
);

// --- Middleware: Tự động tính tiền trước khi lưu ---
transactionSchema.pre("save", function (next) {
  // Nếu có thay đổi về amount hoặc discountPercent thì tính lại finalAmount
  if (this.isModified("amount") || this.isModified("discountPercent")) {
    const discountAmount = this.amount * (this.discountPercent / 100);
    this.finalAmount = this.amount - discountAmount;
  }
  next();
});

const Transaction = mongoose.model("Transaction", transactionSchema);
export default Transaction;
