import { Request, Response } from "express";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

import Invoice, { IInvoice } from "../models/invoiceModel";
import User, { IUser } from "../models/userModel";

dayjs.extend(utc);
dayjs.extend(timezone);

type RowMap = Record<string, string>;

const normalizeHeaderKey = (raw: string): string =>
  String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const normalizeMoneyString = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "0";
  const original = String(value).trim();
  const negative = original.startsWith("-");
  const digits = original.replace(/[.,\s]/g, "").replace(/[^0-9]/g, "");
  if (!digits) return "0";
  return negative ? `-${digits}` : digits;
};

const cellToString = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    const withText = value as { text?: string; result?: string | number; formula?: string };
    if (withText.text) return String(withText.text);
    if (withText.result !== undefined) return String(withText.result);
    if (withText.formula) return String(withText.formula);
  }
  return String(value);
};

const parseWorksheetRows = (worksheet: ExcelJS.Worksheet): RowMap[] => {
  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];

  for (let i = 1; i <= headerRow.cellCount; i++) {
    headers.push(normalizeHeaderKey(cellToString(headerRow.getCell(i).value)));
  }

  const rows: RowMap[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const mapped: RowMap = {};
    let hasValue = false;
    for (let col = 1; col <= headers.length; col++) {
      const key = headers[col - 1];
      if (!key) continue;
      const value = cellToString(row.getCell(col).value).trim();
      if (value) hasValue = true;
      mapped[key] = value;
    }
    if (hasValue) {
      rows.push(mapped);
    }
  }

  return rows;
};

const pickField = (row: RowMap, keys: string[]): string => {
  for (const key of keys) {
    const normalized = normalizeHeaderKey(key);
    if (row[normalized] !== undefined) {
      return String(row[normalized] || "").trim();
    }
  }
  return "";
};

const buildInvoiceDoc = (
  row: RowMap,
  rowIndex: number,
  params: {
    assignedTo?: string;
    province?: string;
    billingPeriod?: string;
    batchId?: number;
  }
) => {
  const invoiceNumber = pickField(row, ["Mã khách hàng", "invoiceNumber", "ma khach hang"]);
  if (!invoiceNumber) return null;

  const customerName = pickField(row, ["Tên", "customerName", "ten"]) || "";
  const customerAddress = pickField(row, ["Địa chỉ", "customerAddress", "dia chi"]) || "";
  const recordBookCode = pickField(row, ["Trạm", "recordBookCode", "tram"]) || "";
  const totalAmount = normalizeMoneyString(pickField(row, ["Tổng tiền", "totalAmount", "tong tien"]));
  const currentAmount = normalizeMoneyString(pickField(row, ["Kỳ nay", "currentAmount", "ky nay"]));
  const previousAmount = normalizeMoneyString(pickField(row, ["Kỳ trước", "previousAmount", "ky truoc"]));

  return {
    invoiceNumber: invoiceNumber.trim(),
    customerName: customerName.trim(),
    customerAddress: customerAddress.trim(),
    recordBookCode: recordBookCode.trim(),
    totalAmount,
    currentAmount,
    previousAmount,
    issueDate: new Date(),
    excelRowIndex: rowIndex,
    sortPriority: params.batchId!,
    excelOrder: params.batchId! * 1000000 + rowIndex,
    assignedTo: params.assignedTo || null,
    province: params.province || "",
    billing_period: params.billingPeriod || "",
  };
};

const makeWorkbookBuffer = async (
  sheetName: string,
  columns: Array<{ header: string; key: string; width: number }>,
  rows: Array<Record<string, unknown>>
): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.columns = columns;
  rows.forEach((row) => worksheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

export const previewExcel = async (req: Request, res: Response) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    if (!files?.excelFile?.length) {
      return res.status(400).json({ message: "Khách hàng không tìm thấy file được tải lên." });
    }

    const userId = String(req.body.userId || "");
    if (!userId) {
      return res.status(400).json({ message: "Thiếu userId." });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Không tìm thấy người dùng." });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(files.excelFile[0].buffer as any);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return res.status(400).json({ message: "File Excel không có sheet dữ liệu." });
    }

    const rows = parseWorksheetRows(worksheet);
    const batchId = Date.now();
    const docs = rows
      .map((row, idx) =>
        buildInvoiceDoc(row, idx + 2, {
          assignedTo: userId,
          province: String(user.province || ""),
          billingPeriod: String(req.body.billing_period || ""),
          batchId
        })
      )
      .filter(Boolean);

    if (!docs.length) {
      return res.status(400).json({ message: "Khách hàng không tìm thấy dữ liệu hợp lệ trong file Excel." });
    }

    const inserted = await Invoice.insertMany(docs, { ordered: true });
    return res.status(200).json({
      message: "Đã thêm hóa đơn thành công.",
      inserted: inserted.length,
    });
  } catch (error) {
    console.error("previewExcel error:", error);
    return res.status(500).json({ message: "Lỗi hệ thống." });
  }
};

export const previewExcelProvince = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Khách hàng không tìm thấy file được tải lên." });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer as any);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return res.status(400).json({ message: "File Excel không có sheet dữ liệu." });
    }

    const rows = parseWorksheetRows(worksheet);
    const batchId = Date.now();
    const assignedUserId = String(req.body.assignedUserId || "").trim() || undefined;
    const docs = rows
      .map((row, idx) =>
        buildInvoiceDoc(row, idx + 2, {
          assignedTo: assignedUserId,
          province: String(req.body.province || ""),
          billingPeriod: String(req.body.billing_period || ""),
          batchId
        })
      )
      .filter(Boolean);

    if (!docs.length) {
      return res.status(400).json({ message: "Khách hàng không tìm thấy dữ liệu hợp lệ trong file Excel." });
    }

    const inserted = await Invoice.insertMany(docs, { ordered: true });
    return res.status(200).json({
      message: "Đã thêm hóa đơn thành công.",
      inserted: inserted.length,
    });
  } catch (error) {
    console.error("previewExcelProvince error:", error);
    return res.status(500).json({ message: "Lỗi hệ thống." });
  }
};

export const exportInvoicesToExcel = async (req: Request, res: Response) => {
  try {
    const { userIds, collectionStatus, paymentStatus, sortField, sortDirection, printStatus, assignedUserId, province, customerCode, stationCode, userprovince, isPaid } = req.query as any;

    // Dynamic sort logic (mirror query.controller)
    const defaultSort: any = { sortPriority: -1, excelRowIndex: 1, excelOrder: 1, _id: 1 };
    let sortObj: any = defaultSort;
    
    if (sortField && sortDirection !== "none") {
      const direction = parseInt(sortDirection) || -1;
      sortObj = { [sortField]: direction, ...defaultSort };
    }
        const filter: Record<string, unknown> = {};

    if (req.user?.role === "user") {
      filter.assignedTo = req.user._id;
    } else if (typeof userIds === "string" && userIds.trim()) {
      filter.assignedTo = { $in: userIds.split(",").map((id) => id.trim()) };
    } else if (assignedUserId && assignedUserId !== "all") {
      if (assignedUserId === "no_one") {
        filter.$or = [{ assignedTo: { $exists: false } }, { assignedTo: null }, { assignedTo: "" }];
      } else if (mongoose.Types.ObjectId.isValid(assignedUserId as string)) {
        filter.assignedTo = new mongoose.Types.ObjectId(assignedUserId as string);
      }
    }

    if (printStatus && printStatus !== "all") {
      filter.printStatus = printStatus === "not_printed" ? { $ne: "printed" } : "printed";
    }

    const provinceValue = (province || userprovince) as string | undefined;
    if (provinceValue && provinceValue !== "all") {
      filter.province = provinceValue;
    }

    if (collectionStatus) {
      if (collectionStatus === "paid") {
        filter.collectionStatus = "collected";
      } else if (collectionStatus === "unpaid") {
        filter.collectionStatus = { $ne: "collected" };
      } else if (collectionStatus === "collected" || collectionStatus === "not_collected") {
        filter.collectionStatus = collectionStatus;
      }
    }

    if (paymentStatus === "true") {
      filter.isPaid = true;
    } else if (paymentStatus === "false") {
      filter.isPaid = false;
    } else if (isPaid === "true") {
      filter.isPaid = true;
    } else if (isPaid === "false") {
      filter.isPaid = false;
    }

    if (customerCode) {
      filter.invoiceNumber = new RegExp(String(customerCode), "i");
    }

    if (stationCode) {
      filter.recordBookCode = new RegExp(String(stationCode), "i");
    }

    const invoices = await Invoice.find(filter)
      .populate("assignedTo", "fullName phone")
      .sort(sortObj)
      .lean();

    if (!invoices.length) {
      return res.status(404).json({ message: "Không tìm thấy dữ liệu phù hợp với bộ lọc." });
    }

    const dataForExcel = invoices.map((invoice, index) => ({
      stt: index + 1,
      maKhachHang: invoice.invoiceNumber || "",
      kyNay: invoice.currentAmount ?? "",
      kyTruoc: invoice.previousAmount ?? "",
      tongTien: invoice.totalAmount ?? "",
      ten: invoice.customerName || "",
      diaChi: invoice.customerAddress || "",
      tram: invoice.recordBookCode || "",
      nguoiPhuTrach: (invoice as { assignedTo?: { fullName?: string } }).assignedTo?.fullName || "N/A",
    }));

    const buffer = await makeWorkbookBuffer(
      "Bao Cao",
      [
        { header: "STT", key: "stt", width: 5 },
        { header: "Mã khách hàng", key: "maKhachHang", width: 17 },
        { header: "Kỳ nay", key: "kyNay", width: 15 },
        { header: "Kỳ trước", key: "kyTruoc", width: 12 },
        { header: "Tổng tiền", key: "tongTien", width: 15 },
        { header: "Tên", key: "ten", width: 35 },
        { header: "Địa chỉ", key: "diaChi", width: 65 },
        { header: "Trạm", key: "tram", width: 12 },
        { header: "Người phụ trách", key: "nguoiPhuTrach", width: 24 },
      ],
      dataForExcel
    );

    const fileName = `bao-cao-hoa-don-${Date.now()}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(buffer);
  } catch (error) {
    console.error("exportInvoicesToExcel error:", error);
    return res.status(500).json({ message: "Lỗi hệ thống." });
  }
};

export const exportCollectedInvoicesByDate = async (req: Request, res: Response) => {
  try {
    const { date: dateParam, sortField, sortDirection } = req.query as any;
    if (!dateParam || Number.isNaN(new Date(String(dateParam)).getTime())) {
      return res.status(400).json({ message: "Tham số 'date' không hợp lệ." });
    }

    const targetDate = new Date(dateParam);
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    // Dynamic sort for collected invoices
    const defaultSortCollected: any = { sortPriority: -1, excelRowIndex: 1, excelOrder: 1, _id: 1 };
    let sortObjCollected: any = defaultSortCollected;
    
    if (sortField && sortDirection !== "none") {
      const direction = parseInt(sortDirection) || -1;
      sortObjCollected = { [sortField]: direction, ...defaultSortCollected };
    }

    const invoices = await Invoice.find({
      collectionStatus: "collected",
      collectionDate: { $gte: startOfDay, $lte: endOfDay },
    })
      .populate("assignedTo", "fullName phone")
      .sort(sortObjCollected)
      .lean();

    if (!invoices.length) {
      return res.status(404).json({ message: "Khách hàng không có dữ liệu hóa đơn để xuất." });
    }

    const dataForExcel = invoices.map((invoice, index) => ({
      stt: index + 1,
      maKhachHang: invoice.invoiceNumber || "",
      kyNay: invoice.currentAmount ?? "",
      kyTruoc: invoice.previousAmount ?? "",
      tongTien: invoice.totalAmount ?? "",
      ten: invoice.customerName || "",
      diaChi: invoice.customerAddress || "",
      tram: invoice.recordBookCode || "",
    }));

    const buffer = await makeWorkbookBuffer(
      "Danh sách hóa đơn",
      [
        { header: "STT", key: "stt", width: 5 },
        { header: "Mã khách hàng", key: "maKhachHang", width: 17 },
        { header: "Kỳ nay", key: "kyNay", width: 15 },
        { header: "Kỳ trước", key: "kyTruoc", width: 12 },
        { header: "Tổng tiền", key: "tongTien", width: 15 },
        { header: "Tên", key: "ten", width: 35 },
        { header: "Địa chỉ", key: "diaChi", width: 65 },
        { header: "Trạm", key: "tram", width: 12 },
      ],
      dataForExcel
    );

    const fileName = `danh-sach-hoa-don-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(buffer);
  } catch (error) {
    console.error("exportCollectedInvoicesByDate error:", error);
    return res.status(500).json({ message: "Lỗi hệ thống." });
  }
};

export const exportExcelByUser = async (req: Request, res: Response) => {
  try {
    const { assignedUserId: userID, sortField, sortDirection } = req.query as any;
    if (!userID || String(userID).trim() === "") {
      return res.status(400).json({ message: "Khách hàng không có dữ liệu người dùng." });
    }

    // Dynamic sort for user export
    const defaultSortUser: any = { sortPriority: -1, excelRowIndex: 1, excelOrder: 1, _id: 1 };
    let sortObjUser: any = defaultSortUser;
    
    if (sortField && sortDirection !== "none") {
      const direction = parseInt(sortDirection) || 1;
      sortObjUser = { [sortField]: direction, ...defaultSortUser };
    }

    const invoices = await Invoice.find({ assignedTo: userID })
      .populate("assignedTo", "fullName phone")
      .sort(sortObjUser)
      .lean();

    if (!invoices.length) {
      return res.status(404).json({ message: "Khách hàng không tìm thấy dữ liệu hóa đơn nào với bộ lọc này." });
    }

    const userInfo = invoices[0].assignedTo as IUser | undefined;
    const userName = String(userInfo?.fullName || "khong-ro")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase();

    const dataForExcel = invoices.map((invoice, index) => ({
      stt: index + 1,
      maKhachHang: invoice.invoiceNumber || "",
      kyNay: invoice.currentAmount ?? "",
      kyTruoc: invoice.previousAmount ?? "",
      tongTien: invoice.totalAmount ?? "",
      ten: invoice.customerName || "",
      diaChi: invoice.customerAddress || "",
      tram: invoice.recordBookCode || "",
    }));

    const buffer = await makeWorkbookBuffer(
      "Danh Sach Hoa Don",
      [
        { header: "STT", key: "stt", width: 5 },
        { header: "Mã khách hàng", key: "maKhachHang", width: 17 },
        { header: "Kỳ nay", key: "kyNay", width: 15 },
        { header: "Kỳ trước", key: "kyTruoc", width: 12 },
        { header: "Tổng tiền", key: "tongTien", width: 15 },
        { header: "Tên", key: "ten", width: 35 },
        { header: "Địa chỉ", key: "diaChi", width: 65 },
        { header: "Trạm", key: "tram", width: 12 },
      ],
      dataForExcel
    );

    const fileName = `danh-sach-hoa-don-do-${userName}-phu-trach.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(buffer);
  } catch (error) {
    console.error("exportExcelByUser error:", error);
    return res.status(500).json({ message: "Lỗi hệ thống." });
  }
};

export const exportExcelCollected = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate, isClosed, status, userIds, sortField, sortDirection } = req.query as any;
    if (!fromDate || !toDate) {
      return res.status(400).json({ message: "Vui lòng chọn khoảng thời gian (Từ ngày - Đến ngày)." });
    }

    const startOfDay = dayjs.tz(String(fromDate), "Asia/Ho_Chi_Minh").startOf("day").toDate();
    const endOfDay = dayjs.tz(String(toDate), "Asia/Ho_Chi_Minh").endOf("day").toDate();

    const match: Record<string, unknown> = {};
    if (status === "paid") {
      match.collectionStatus = "collected";
      match.collectionDate = { $gte: startOfDay, $lte: endOfDay };
    } else if (status === "unpaid") {
      match.collectionStatus = "not_collected";
      match.updatedAt = { $gte: startOfDay, $lte: endOfDay };
    } else if (status === "closed") {
      // Đã đóng cước trong khoảng thời gian
      match.isPaid = true;
      match.updatedAt = { $gte: startOfDay, $lte: endOfDay };
    } else {
      // Tất cả: lấy cả đã thu và chưa thu trong khoảng thời gian
      match.$or = [
        { collectionDate: { $gte: startOfDay, $lte: endOfDay } },
        {
          collectionStatus: "not_collected",
          updatedAt: { $gte: startOfDay, $lte: endOfDay },
        },
      ];
    }

    if (typeof userIds === "string" && userIds.trim()) {
      const idsArray = userIds
        .split(",")
        .map((id) => id.trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      if (idsArray.length) {
        match.assignedTo = { $in: idsArray };
      }
    }

    if (isClosed && isClosed !== "all") {
      match.isPaid = isClosed === "true";
    }

    // Dynamic sort for collected export
    // Mặc định: status=paid → sắp xếp theo collectionDate giảm dần (mới nhất lên đầu)
    //          status khác → sắp xếp theo thứ tự import gốc
    const defaultSortCollectedExp: any =
      status === "paid"
        ? { collectionDate: -1, _id: 1 }
        : { sortPriority: -1, excelRowIndex: 1, excelOrder: 1, _id: 1 };
    let sortObjCollectedExp: any = defaultSortCollectedExp;
    
    if (sortField && sortDirection !== "none") {
      const direction = parseInt(sortDirection) || 1;
      sortObjCollectedExp = { [sortField]: direction, ...defaultSortCollectedExp };
    }

    const invoices = await Invoice.find(match)
      .populate("assignedTo", "fullName phone")
      .sort(sortObjCollectedExp)
      .lean();

    if (!invoices.length) {
      return res.status(404).json({ message: "Khách hàng không tìm thấy dữ liệu hóa đơn nào với bộ lọc này." });
    }

    const rows = invoices.map((invoice, index) => ({
      stt: index + 1,
      maKhachHang: invoice.invoiceNumber || "",
      kyNay: invoice.currentAmount ?? "",
      kyTruoc: invoice.previousAmount ?? "",
      tongTien: invoice.totalAmount ?? "",
      ten: invoice.customerName || "",
      diaChi: invoice.customerAddress || "",
      tram: invoice.recordBookCode || "",
      nguoiPhuTrach: (invoice.assignedTo as { fullName?: string } | undefined)?.fullName || "Chưa phân công",
      daThu: invoice.collectionStatus === "collected" ? "Đã thu" : "Chưa thu",
      thoiDiemThu: invoice.collectionDate
        ? dayjs(invoice.collectionDate).tz("Asia/Ho_Chi_Minh").format("HH:mm DD/MM/YYYY")
        : "",
    }));

    const buffer = await makeWorkbookBuffer(
      "Danh Sach Hoa Don",
      [
        { header: "STT", key: "stt", width: 5 },
        { header: "Mã khách hàng", key: "maKhachHang", width: 15 },
        { header: "Kỳ nay", key: "kyNay", width: 12 },
        { header: "Kỳ trước", key: "kyTruoc", width: 12 },
        { header: "Tổng tiền", key: "tongTien", width: 14 },
        { header: "Tên", key: "ten", width: 25 },
        { header: "Địa chỉ", key: "diaChi", width: 35 },
        { header: "Trạm", key: "tram", width: 10 },
        { header: "Người phụ trách", key: "nguoiPhuTrach", width: 20 },
        { header: "Đã thu", key: "daThu", width: 10 },
        { header: "Thời điểm thu", key: "thoiDiemThu", width: 18 },
      ],
      rows
    );

    const formatSimpleDate = (dateStr: unknown) => {
      const raw = String(dateStr || "");
      const parts = raw.split("-");
      if (parts.length === 3) return `${parts[2]}-${parts[1]}`;
      return raw;
    };

    let filePrefix = "Tong-Hop-Hoa-Don";
    if (status === "paid") filePrefix = "DS-Hoa-Don-Da-Thu";
    if (status === "unpaid") filePrefix = "DS-Chua-Thu";
    if (status === "closed") filePrefix = "DS-Da-Dong-Cuoc";
    if (status === "all") filePrefix = "DS-Tat-Ca";
    if (isClosed === "true") filePrefix += "-Da-Dong-Cuoc";
    if (isClosed === "false") filePrefix += "-Chua-Dong-Cuoc";

    const fileName = `${filePrefix}_${formatSimpleDate(fromDate)}_den_${formatSimpleDate(toDate)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
    return res.send(buffer);
  } catch (error) {
    console.error("exportExcelCollected error:", error);
    return res.status(500).json({ message: "Lỗi hệ thống." });
  }
};




