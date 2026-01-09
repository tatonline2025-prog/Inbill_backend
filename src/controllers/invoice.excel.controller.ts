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
 * Hàm làm sạch chuỗi số từ Excel
 */
const cleanNumberString = (value: any): string => {
  if (value === null || value === undefined || value === "") return "0";

  let str = String(value).trim();

  const isNegative = str.startsWith("-");

  str = str.replace(/[.,]/g, "");

  str = str.replace(/[^0-9]/g, "");

  return isNegative ? `-${str}` : str;
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
          let value = row[excelHeader] ?? "";

          // Kiểm tra nếu là các cột liên quan đến số tiền thì làm sạch dữ liệu
          if (["totalAmount", "currentAmount", "previousAmount"].includes(dbField)) {
            newDoc[dbField] = cleanNumberString(value);
          } else {
            newDoc[dbField] = value;
          }
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
          let value = row[excelHeader] ?? "";

          // Kiểm tra nếu là các cột liên quan đến số tiền thì làm sạch dữ liệu
          if (["totalAmount", "currentAmount", "previousAmount"].includes(dbField)) {
            newDoc[dbField] = cleanNumberString(value);
          } else {
            newDoc[dbField] = value;
          }
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
  try {
    const { userIds, collectionStatus, paymentStatus } = req.query;

    let filter: any = {};

    if (req.user?.role === "user") {
      filter.assignedTo = req.user._id;
    } else if (userIds) {
      const idArray = (userIds as string).split(",");
      filter.assignedTo = { $in: idArray };
    }

    if (collectionStatus === "paid") {
      filter.collectionStatus = "collected";
    } else if (collectionStatus === "unpaid") {
      filter.collectionStatus = { $ne: "collected" };
    }

    if (paymentStatus === "true") {
      filter.isPaid = true;
    } else if (paymentStatus === "false") {
      filter.isPaid = false;
    }

    const invoices = await Invoice.find(filter).populate("assignedTo", "fullName phone").lean();

    if (!invoices.length) {
      return res.status(404).json({ message: "Không tìm thấy dữ liệu phù hợp với bộ lọc." });
    }

    // 4️⃣ Chuẩn bị dữ liệu cho Excel
    const dataForExcel = invoices.map((invoice, index) => ({
      STT: index + 1,
      "Mã khách hàng": invoice.invoiceNumber || "",
      "Kỳ này": invoice.currentAmount ?? "",
      "Kỳ trước": invoice.previousAmount ?? "",
      "Tổng tiền": invoice.totalAmount ?? "",
      Tên: invoice.customerName || "",
      "Địa chỉ": invoice.customerAddress || "",
      Trạm: invoice.recordBookCode,
      "Người phụ trách": (invoice as any).assignedTo?.fullName || "N/A",
    }));

    // 5️⃣ Tạo Workbook và gửi file
    const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Báo cáo");

    // Giả định bạn đã có hàm configureColumnWidths
    configureColumnWidths(worksheet);

    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    const fileName = `bao-cao-hoa-don-${new Date().getTime()}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(buffer);
  } catch (error: any) {
    console.error("❌ Lỗi Backend Export:", error);
    return res.status(500).json({ message: "Lỗi hệ thống", detail: error.message });
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
      .populate("assignedTo", "fullName  phone")
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
      .populate("assignedTo", "fullName  phone")
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
    // 1. Lấy tham số từ Query String
    const { fromDate, toDate, isClosed, status, userIds } = req.query;

    // console.log("Params:", { fromDate, toDate, isClosed, status, userIds });

    // 2. Validate ngày tháng
    if (!fromDate || !toDate) {
      return res.status(400).json({ message: "Vui lòng chọn khoảng thời gian (Từ ngày - Đến ngày)." });
    }

    // Xử lý Timezone Việt Nam: Đầu ngày (00:00:00) và Cuối ngày (23:59:59)
    const startOfDay = dayjs
      .tz(fromDate as string, "Asia/Ho_Chi_Minh")
      .startOf("day")
      .toDate();
    const endOfDay = dayjs
      .tz(toDate as string, "Asia/Ho_Chi_Minh")
      .endOf("day")
      .toDate();

    // 3. Khởi tạo điều kiện lọc (Match Query)
    const match: any = {};

    // --- Xử lý Date & Status ---
    // Logic:
    // - Nếu chọn "Đã thu" (paid) -> Lọc theo ngày thu (collectionDate).
    // - Nếu chọn "Chưa thu" hoặc "Tất cả" -> Lọc theo ngày tạo hóa đơn (createdAt) để không bị sót đơn.

    if (status === "paid") {
      match.collectionStatus = "collected";
      match.collectionDate = { $gte: startOfDay, $lte: endOfDay };
    } else if (status === "unpaid") {
      match.collectionStatus = "not_collected";
      match.updatedAt = { $gte: startOfDay, $lte: endOfDay };
    } else {
      // status === 'all'
      // Khi chọn tất cả, ta lọc theo ngày tạo để lấy trọn vẹn danh sách trong khoảng thời gian đó
      match.updatedAt = { $gte: startOfDay, $lte: endOfDay };
    }

    // --- Xử lý User (Nhiều người) ---
    // userIds dạng string: "id1,id2,id3"
    if (userIds && typeof userIds === "string" && userIds.trim() !== "") {
      const idsArray = userIds.split(",").map((id) => new mongoose.Types.ObjectId(id.trim()));
      match.assignedTo = { $in: idsArray };
    }

    // --- Xử lý IsClosed (Trạng thái đóng cước) ---
    if (isClosed && isClosed !== "all") {
      // Giả sử trong DB field là isPaid (boolean)
      match.isPaid = isClosed === "true";
    }

    // 4. Truy vấn Database
    // populate assignedTo để lấy tên nhân viên
    const invoices: any[] = await Invoice.find(match)
      .populate("assignedTo", "fullName  phone")
      .sort({ updatedAt: -1 }) // Sắp xếp mới nhất trước
      .lean();

    if (!invoices.length) {
      return res.status(404).json({ message: "Không tìm thấy dữ liệu hóa đơn nào với bộ lọc này." });
    }

    // 5. Map dữ liệu sang format Excel
    const dataForExcel = invoices.map((invoice, index) => {
      // Xác định trạng thái hiển thị
      const statusText = invoice.collectionStatus === "collected" ? "Đã thu" : "Chưa thu";
      // const closedText = invoice.isPaid ? "Đã đóng cước" : "Chưa đóng cước";
      // const collectionDateStr = invoice.collectionDate
      //   ? dayjs(invoice.collectionDate).tz("Asia/Ho_Chi_Minh").format("DD/MM/YYYY HH:mm")
      //   : "";

      return {
        STT: index + 1,
        "Mã khách hàng": invoice.invoiceNumber || "",
        "Kỳ này": invoice.currentAmount ?? "",
        "Kỳ trước": invoice.previousAmount ?? "",
        "Tổng tiền": invoice.totalAmount ?? "",
        Tên: invoice.customerName || "",
        "Địa chỉ": invoice.customerAddress || "",
        Trạm: invoice.recordBookCode,
        "Người phụ trách": invoice.assignedTo?.fullName || "Chưa phân công",
        "Đã thu": statusText,
      };
    });

    // 6. Tạo File Excel
    const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Danh Sách Hóa Đơn");

    // Tự động chỉnh độ rộng cột (Optional)
    const wscols = [
      { wch: 5 },
      { wch: 15 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 25 },
      { wch: 35 },
      { wch: 10 },
      { wch: 20 },
      { wch: 10 },
    ];
    worksheet["!cols"] = wscols;

    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });

    // 7. Gửi Response
    let filePrefix = "Tong-Hop-Hoa-Don"; // Mặc định

    // Logic đặt tên
    if (status === "paid") {
      filePrefix = "DS-Hoa-Don-Da-Thu"; // Danh sách đã thu
    } else if (status === "unpaid") {
      filePrefix = "DS-Chua-Thu"; // Danh sách chưa thu
    }

    // Nếu có lọc thêm đóng cước, thêm hậu tố cho rõ
    if (isClosed === "true") {
      filePrefix += "-Da-Dong-Cuoc";
    } else if (isClosed === "false") {
      filePrefix += "-Chua-Dong-Cuoc";
    }

    // Format lại ngày cho gọn (Giả sử input là YYYY-MM-DD)
    // Ví dụ: 2025-12-08 -> 08-12
    const formatSimpleDate = (dateStr: any) => {
      if (!dateStr) return "";
      const parts = dateStr.split("-"); // [2025, 12, 08]
      if (parts.length === 3) return `${parts[2]}-${parts[1]}`; // 08-12
      return dateStr;
    };

    const from = formatSimpleDate(fromDate);
    const to = formatSimpleDate(toDate);

    // Kết quả: "DS-Da-Thu_08-12_den_11-12.xlsx"
    const fileName = `${filePrefix}_${from}_den_${to}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);

    res.send(buffer);
  } catch (error) {
    console.error("Lỗi khi xuất file Excel:", error);
    res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};
