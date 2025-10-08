import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    // Tên đăng nhập, không được trùng
    username: { type: String, required: true, unique: true, trim: true },

    // Mật khẩu đã được mã hoá (bắt buộc)
    password: { type: String, required: true },

    // Tên đầy đủ của người dùng
    fullName: { type: String, required: true },

    email: { type: String, required: true, unique: true },

    // Dùng để phân quyền hệ thống
    role: {
      type: String,
      enum: ["admin", "user"], // Chỉ chấp nhận 2 giá trị này
      default: "user",
    },

    // Lưu ID của admin đã tạo ra user này (giúp cho việc truy vết)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Tham chiếu đến chính model User
      default: null, // Admin đầu tiên sẽ không có ai tạo ra
    },
  },
  {
    // Tự động thêm 2 trường createdAt và updatedAt
    timestamps: true,
  }
);

const User = mongoose.model("User", userSchema);
export default User;
