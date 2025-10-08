import mongoose from "mongoose";

const excelUploadSchema = new mongoose.Schema(
  {
    // Tên file gốc
    fileName: { type: String, required: true },

    // Trạng thái xử lý file: đang xử lý, hoàn thành, thất bại
    status: { type: String, enum: ["processing", "completed", "failed"], default: "processing" },

    // Ghi chú lỗi nếu xử lý thất bại
    errorMessage: { type: String },

    // Số lượng hoá đơn đã được tạo ra từ file này
    invoiceCount: { type: Number, default: 0 },

    // Admin đã thực hiện việc upload
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  {
    timestamps: true,
  }
);

const ExcelUpload = mongoose.model("ExcelUpload", excelUploadSchema);
export default ExcelUpload;
