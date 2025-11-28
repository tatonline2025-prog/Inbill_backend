import { Request, Response } from "express";
import * as XLSX from "xlsx";
import Invoice, { IInvoice } from "../models/invoiceModel";
import User, { IUser } from "../models/userModel";
import mongoose from "mongoose";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

// --- [ Import Excel ] ---

const columnMapping = {
  "Mã khách hàng": "invoiceNumber",
  Tên: "customerName",
  "Địa chỉ": "customerAddress",
  "Tổng tiền": "totalAmount",
  "Kỳ này": "currentAmount",
  "Kỳ trước": "previousAmount",
  // Kỳ: "billing_period",
  Trạm: "recordBookCode",
  // Thêm các mapping khác nếu cần
};

/**
 * Nhập và cập nhật/thêm mới hóa đơn từ Excel (dành cho người dùng/người thu).
 * POST /api/invoices/excel-preview
 */
export const previewExcel = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Không tìm thấy file nào được tải lên." });
    }

    const { userId } = req.body;

    const user = await User.findById(userId);
    if (!user) res.status(400).json({ message: "Không tìm thấy người dùng trong CSDL" });

    const fileBuffer = req.file.buffer;
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

    // Tạo danh sách hóa đơn
    const documentsToCreate = jsonData
      .map((row) => {
        const newDoc: any = {
          assignedTo: userId,
          province: user?.province,
          billing_period: req.body.billing_period,
          issueDate: new Date(),
        };

        for (const excelHeader in columnMapping) {
          const dbField = columnMapping[excelHeader as keyof typeof columnMapping];
          newDoc[dbField] = row[excelHeader] ?? "";
        }

        if (!newDoc.invoiceNumber) return null;
        return newDoc;
      })
      .filter(Boolean);

    if (documentsToCreate.length === 0) {
      return res.status(400).json({
        message: `Không tìm thấy dữ liệu hợp lệ trong file Excel. Vui lòng kiểm tra lại tên các cột.`,
      });
    }

    // 🔹 Cập nhật / thêm mới hoá đơn
    const bulkOps = documentsToCreate.map((doc) => ({
      updateOne: {
        filter: {
          invoiceNumber: doc.invoiceNumber,
        },
        update: { $set: doc },
        upsert: true,
      },
    }));

    const result = await Invoice.bulkWrite(bulkOps);

    res.status(200).json({
      message: "Đã thêm/cập nhật hoá đơn thành công.",
      inserted: result.upsertedCount,
      modified: result.modifiedCount,
    });
  } catch (error) {
    console.error("Lỗi khi xử lý file Excel:", error);
    res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};

/**
 * Nhập và cập nhật/thêm mới hóa đơn từ Excel (dành cho Admin, chỉ gán province).
 * POST /api/invoices/excel-preview-province
 */
export const previewExcelProvince = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Không tìm thấy file nào được tải lên." });
    }

    const fileBuffer = req.file.buffer;
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

    // console.log("Excel raw data:", jsonData);

    const documentsToCreate = jsonData
      .map((row) => {
        const newDoc: any = {
          issueDate: new Date(),
          province: req.body.province,
          billing_period: req.body.billing_period,
        };

        for (const excelHeader in columnMapping) {
          const dbField = columnMapping[excelHeader as keyof typeof columnMapping];
          newDoc[dbField] = row[excelHeader] ?? "";
        }

        if (!newDoc.invoiceNumber) return null;
        return newDoc;
      })
      .filter(Boolean);

    if (documentsToCreate.length === 0) {
      return res.status(400).json({
        message: `Không tìm thấy dữ liệu hợp lệ trong file Excel. Vui lòng kiểm tra lại tên các cột.`,
      });
    }

    const bulkOps = documentsToCreate.map((doc) => ({
      updateOne: {
        filter: {
          invoiceNumber: doc.invoiceNumber,
        },
        update: { $set: doc },
        upsert: true,
      },
    }));

    const result = await Invoice.bulkWrite(bulkOps);

    res.status(200).json({
      message: "Đã thêm/cập nhật hoá đơn thành công.",
      inserted: result.upsertedCount,
      modified: result.modifiedCount,
    });
  } catch (error) {
    console.error("Lỗi khi xử lý file Excel:", error);
    res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};

// --- [ Export Excel ] ---

/**
 * Hàm trợ giúp để cấu hình độ rộng cột
 */
const configureColumnWidths = (worksheet: XLSX.WorkSheet) => {
  worksheet["!cols"] = [
    { wch: 5 }, // STT
    { wch: 17 }, // Mã KH
    { wch: 15 }, // Kỳ này
    { wch: 10 }, // Kỳ trước
    { wch: 15 }, // Tổng tiền
    { wch: 35 }, // Tên KH
    { wch: 65 }, // Địa chỉ
    { wch: 10 }, // Trạm
  ];
};

/**
 * Xuất tất cả hóa đơn (hoặc theo người dùng nếu là user role).
 * GET /api/invoices/export-all?userId=...&userRole=...
 */
export const exportInvoicesToExcel = async (req: Request, res: Response) => {
  // console.log(req.user?._id, req.user?.role);

  try {
    // 1️⃣ Lấy tất cả dữ liệu hóa đơn
    let invoices: IInvoice[];
    if (req.user?.role === "user") {
      invoices = await Invoice.find({ assignedTo: req.user?._id })
        .populate("assignedTo", "fullName email phone")
        .lean();
    } else {
      invoices = await Invoice.find({}).populate("assignedTo", "fullName email phone").lean();
    }

    if (!invoices.length) {
      return res.status(404).json({ message: "Không có dữ liệu hóa đơn để xuất." });
    }

    // 2️⃣ Chuẩn bị dữ liệu xuất ra Excel — giống cấu trúc bên exportInvoicesToExcelPrinted
    const dataForExcel = invoices.map((invoice, index) => ({
      STT: index + 1,
      "Mã khách hàng": invoice.invoiceNumber || "",
      "Kỳ này": invoice.currentAmount ?? "",
      "Kỳ trước": invoice.previousAmount ?? "",
      "Tổng tiền": invoice.totalAmount ?? "",
      Tên: invoice.customerName || "",
      "Địa chỉ": invoice.customerAddress || "",
      Trạm: invoice.recordBookCode,
    }));

    // 3️⃣ Tạo workbook + worksheet
    const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Danh Sách Hóa Đơn");

    // 4️⃣ Cấu hình độ rộng cột — đồng bộ với hàm Printed
    configureColumnWidths(worksheet);

    // 5️⃣ Xuất ra buffer
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });

    // 6️⃣ Gửi file về client
    const fileName = `tat-ca-hoa-don-${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    console.error("❌ Lỗi khi xuất file Excel:", error);
    res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};

/**
 * Xuất hóa đơn đã thu theo ngày (dành cho Admin).
 * GET /api/invoices/export-printed?date=YYYY-MM-DD
 * Lưu ý: Tên hàm gốc là `exportInvoicesToExcelPrinted`, tôi đổi thành `exportCollectedInvoicesByDate` cho rõ ràng hơn
 */
export const exportCollectedInvoicesByDate = async (req: Request, res: Response) => {
  try {
    const dateParam = req.query.date as string | undefined;

    // 🛑 Kiểm tra tham số ngày
    if (!dateParam || isNaN(new Date(dateParam).getTime())) {
      return res.status(400).json({ message: "Tham số 'date' không hợp lệ." });
    }

    // ✅ Chuẩn hóa thời gian trong ngày
    const targetDate = new Date(dateParam);
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    // ✅ Lấy dữ liệu hóa đơn đã thu trong ngày
    const invoices: IInvoice[] = await Invoice.find({
      collectionStatus: "collected",
      collectionDate: { $gte: startOfDay, $lte: endOfDay },
    })
      .populate("assignedTo", "fullName email phone")
      .lean();

    if (!invoices.length) {
      return res.status(404).json({ message: "Không có dữ liệu hóa đơn để xuất." });
    }

    // ✅ Chuẩn bị dữ liệu xuất ra Excel
    const dataForExcel = invoices.map((invoice, index) => ({
      STT: index + 1,
      "Mã khách hàng": invoice.invoiceNumber || "",
      "Kỳ này": invoice.currentAmount ?? "",
      "Kỳ trước": invoice.previousAmount ?? "",
      "Tổng tiền": invoice.totalAmount ?? "",
      Tên: invoice.customerName || "",
      "Địa chỉ": invoice.customerAddress || "",
      Trạm: invoice.recordBookCode,
    }));

    // ✅ Tạo workbook + worksheet
    const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Danh Sách Hóa Đơn");

    // ✅ Cấu hình độ rộng cột
    configureColumnWidths(worksheet);

    // ✅ Xuất ra buffer và gửi về client
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="danh-sach-hoa-don-${new Date().toISOString().slice(0, 10)}.xlsx"`
    );

    res.send(buffer);
  } catch (error) {
    console.error("Lỗi khi xuất file Excel:", error);
    res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};

/**
 * Xuất hóa đơn theo người phụ trách (Admin/Manager).
 * GET /api/invoices/export-by-user?assignedUserId=...
 */
export const exportExcelByUser = async (req: Request, res: Response) => {
  try {
    const userID = req.query.assignedUserId as string | undefined;

    if (!userID) {
      return res.status(400).json({ message: "Không có dữ liệu người dùng" });
    }

    // ✅ Lấy dữ liệu hóa đơn theo người phụ trách
    const invoices: IInvoice[] = await Invoice.find({ assignedTo: userID })
      .populate("assignedTo", "fullName email phone")
      .lean();

    if (!invoices.length) {
      return res.status(404).json({ message: "Không có dữ liệu hóa đơn để xuất." });
    }

    // ✅ Lấy tên người phụ trách
    const userInfo: IUser | null = invoices[0].assignedTo as IUser;
    const userName = userInfo?.fullName || "khong-ro";

    // ✅ Chuẩn hoá tên để dùng trong tên file (bỏ dấu, cách -> -)
    const normalizeFileName = (str: string) =>
      str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // bỏ dấu tiếng Việt
        .replace(/\s+/g, "-") // thay khoảng trắng bằng dấu -
        .toLowerCase();

    const safeUserName = normalizeFileName(userName);

    // ✅ Chuẩn bị dữ liệu Excel
    const dataForExcel = invoices.map((invoice, index) => ({
      STT: index + 1,
      "Mã khách hàng": invoice.invoiceNumber || "",
      "Kỳ này": invoice.currentAmount ?? "",
      "Kỳ trước": invoice.previousAmount ?? "",
      "Tổng tiền": invoice.totalAmount ?? "",
      Tên: invoice.customerName || "",
      "Địa chỉ": invoice.customerAddress || "",
      Trạm: invoice.recordBookCode,
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Danh Sách Hóa Đơn");

    configureColumnWidths(worksheet);

    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });

    const fileName = `danh-sach-hoa-don-do-${safeUserName}-phu-trach.xlsx`;

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    res.send(buffer);
  } catch (error) {
    console.error("Lỗi khi xuất file Excel:", error);
    res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};

/**
 * Xuất hóa đơn đã thu theo ngày và tùy chọn theo người dùng (Admin/Manager).
 * GET /api/invoices/export-collected?date=YYYY-MM-DD&assignedUserId=...
 */
export const exportExcelCollected = async (req: Request, res: Response) => {
  try {
    const { date, assignedUserId } = req.query;
    const dateParam = date as string | undefined;

    if (!dateParam || isNaN(new Date(dateParam).getTime())) {
      return res.status(400).json({ message: "Tham số 'date' không hợp lệ." });
    }

    const startOfDay = dayjs.tz(dateParam, "Asia/Ho_Chi_Minh").startOf("day").toDate();
    const endOfDay = dayjs.tz(dateParam, "Asia/Ho_Chi_Minh").endOf("day").toDate();

    const match: any = {
      collectionStatus: "collected",
      collectionDate: { $gte: startOfDay, $lte: endOfDay },
    };

    // Thêm điều kiện lọc theo nhân viên nếu có
    if (assignedUserId && assignedUserId !== "all") {
      match.assignedTo = new mongoose.Types.ObjectId(assignedUserId as string);
    }

    const invoices: IInvoice[] = await Invoice.find(match).populate("assignedTo", "fullName email phone").lean();

    if (!invoices.length) {
      return res.status(404).json({ message: "Không có dữ liệu hóa đơn để xuất." });
    }

    const dataForExcel = invoices.map((invoice, index) => ({
      STT: index + 1,
      "Mã khách hàng": invoice.invoiceNumber || "",
      "Kỳ này": invoice.currentAmount ?? "",
      "Kỳ trước": invoice.previousAmount ?? "",
      "Tổng tiền": invoice.totalAmount ?? "",
      Tên: invoice.customerName || "",
      "Địa chỉ": invoice.customerAddress || "",
      Trạm: invoice.recordBookCode,
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Hóa Đơn Đã Thu");

    configureColumnWidths(worksheet);

    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });

    // Đặt tên file động
    const fileName = `hoa-don-da-thu-${dateParam}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(fileName)}"` // Mã hóa tên file
    );

    res.send(buffer);
  } catch (error) {
    console.error("Lỗi khi xuất file Excel:", error);
    res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};
