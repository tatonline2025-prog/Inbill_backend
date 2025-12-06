import mongoose from "mongoose";

const bankSchema = new mongoose.Schema(
  {
    // Tên ngân hàng (Ví dụ: Vietcombank, Techcombank)
    bankName: {
      type: String,
      required: true,
      trim: true,
    },

    // Số tài khoản ngân hàng
    accountNumber: {
      type: String,
      required: true,
      unique: true, // Số tài khoản phải là duy nhất
      trim: true,
    },

    // Tên chủ tài khoản
    accountHolder: {
      type: String,
      required: true,
      trim: true,
    },

    // Chi nhánh (Tùy chọn)
    branch: {
      type: String,
      required: false,
      trim: true,
    },

    // Lưu ID của Admin đã thêm thông tin bank này
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

const Bank = mongoose.model("Bank", bankSchema);
export default Bank;
