import mongoose from "mongoose";

const transactionTypeSchema = new mongoose.Schema(
  {
    // Tên loại giao dịch (Ví dụ: "Tour Du Lịch Cao Cấp")
    name: {
      type: String,
      required: true,
      unique: true, // Tên loại giao dịch không được trùng
      trim: true,
    },

    // Mô tả chi tiết (Admin tạo)
    description: {
      type: String,
      required: false,
      trim: true,
      default: "",
    },

    discountPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 0,
    },

    bankId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bank", // Liên kết đến Model Bank (Giả định bạn có model Bank)
      required: true, // Bắt buộc phải chọn ngân hàng cho loại giao dịch này
    },

    // Lưu ID của Admin đã tạo ra loại hình này (giúp truy vết)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Liên kết đến Model User
      required: true,
    },
  },
  {
    timestamps: true, // Tự động thêm createdAt và updatedAt
  }
);

const TransactionType = mongoose.model("TransactionType", transactionTypeSchema);
export default TransactionType;
