import mongoose from "mongoose";

const transactionTypeSchema = new mongoose.Schema(
  {
    // Tên loại giao dịch
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // Mô tả (nếu cần)
    description: {
      type: String,
      default: "",
    },

    // Trạng thái (Admin có thể ẩn loại này đi thay vì xóa vĩnh viễn)
    isActive: {
      type: Boolean,
      default: true,
    },

    // Admin tạo ra loại này
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const TransactionType = mongoose.model("TransactionType", transactionTypeSchema);
export default TransactionType;
