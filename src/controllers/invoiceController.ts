import { Request, Response } from "express";
import Invoice, { IInvoice } from "../models/invoiceModel";
import User, { IUser } from "../models/userModel";
import mongoose from "mongoose";

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const normalizeMoneyString = (value: any): string => {
  if (value === null || value === undefined) return "0";

  if (typeof value === "number") {
    return Math.trunc(value).toString();
  }

  if (typeof value === "string") {
    const cleaned = value.trim().replace(/[^\d]/g, ""); // giữ lại CHỈ số

    return cleaned || "0";
  }

  return "0";
};

export const toggleInvoiceStatus = async (req: Request, res: Response) => {
  try {
    const invoiceId = req.params.invoiceId;
    const { field } = req.body; // "printStatus" | "collectionStatus"

    if (!["printStatus", "collectionStatus"].includes(field)) {
      return res.status(400).json({ message: "Field không hợp lệ" });
    }

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return res.status(404).json({ message: "Hóa đơn không tồn tại" });

    if (!invoice.currentAmount || invoice.currentAmount.trim() === "") {
      invoice.currentAmount = "0";
    }

    // Toggle trạng thái
    if (field === "printStatus") {
      invoice.printStatus = invoice.printStatus === "printed" ? "not_printed" : "printed";
    } else if (field === "collectionStatus") {
      const isAdmin = req.user?.role === "admin";
      if (invoice.collectionStatus === "collected") {
        invoice.collectionStatus = "not_collected";
        invoice.collectionDate = null;
        invoice.collectionDateAdminEdited = false;
      } else {
        invoice.collectionStatus = "collected";
        invoice.collectionDate = new Date();
        invoice.collectionDateAdminEdited = false;
        if (typeof req.user?.province === "string" && req.user.province.trim() !== "") {
          invoice.province = req.user.province;
        }
        // Admin không trở thành người phụ trách; user thường đã thu sau cùng sẽ là người phụ trách
        if (!isAdmin) {
          invoice.assignedTo = req.user?._id as unknown as mongoose.Types.ObjectId;
        }
      }
    }

    await invoice.save();

    res.status(200).json(invoice);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Lỗi server" });
  }
};

/**
 * Admin set/đổi ngày thu thủ công cho hóa đơn (đơn bổ sung).
 * PATCH /api/invoices/:invoiceId/collection-date  body: { date: "YYYY-MM-DD" | null }
 */
export const updateCollectionDateByAdmin = async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Chỉ admin được phép thay đổi ngày thu." });
    }

    const invoiceId = req.params.invoiceId;
    const { date } = req.body as { date?: string | null };

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return res.status(404).json({ message: "Hóa đơn không tồn tại" });

    if (!date) {
      invoice.collectionStatus = "not_collected";
      invoice.collectionDate = null;
      invoice.collectionDateAdminEdited = false;
    } else {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
      if (!m) return res.status(400).json({ message: "Ngày không hợp lệ (YYYY-MM-DD)." });
      const d = new Date(`${date}T12:00:00.000Z`);
      if (isNaN(d.getTime())) return res.status(400).json({ message: "Ngày không hợp lệ." });
      invoice.collectionStatus = "collected";
      invoice.collectionDate = d;
      invoice.collectionDateAdminEdited = true;
    }

    await invoice.save();
    return res.status(200).json(invoice);
  } catch (err) {
    console.error("updateCollectionDateByAdmin error:", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

/**
 * Cập nhật hàng loạt cho các hóa đơn được chọn.
 * PATCH /api/invoices/bulk-update
 * body: { ids: string[], updates: { recordBookCode?, assignedTo?, billing_period?, collectionStatus? } }
 */
export const bulkUpdateInvoices = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Không xác định được người dùng" });

    const { ids, updates } = (req.body || {}) as {
      ids?: string[];
      updates?: {
        recordBookCode?: string;
        assignedTo?: string | null;
        billing_period?: string;
        collectionStatus?: "collected" | "not_collected";
      };
    };

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "Thiếu danh sách hóa đơn cần cập nhật." });
    }
    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "Thiếu dữ liệu cập nhật." });
    }

    const isAdmin = user.role === "admin";
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, unknown> = {};

    if (typeof updates.recordBookCode === "string" && updates.recordBookCode.trim() !== "") {
      $set.recordBookCode = updates.recordBookCode.trim();
    }
    if (typeof updates.billing_period === "string" && updates.billing_period.trim() !== "") {
      $set.billing_period = updates.billing_period.trim();
    }
    if (updates.assignedTo !== undefined) {
      if (updates.assignedTo === null || updates.assignedTo === "") {
        $set.assignedTo = null;
      } else {
        $set.assignedTo = updates.assignedTo;
      }
    }

    if (updates.collectionStatus === "collected") {
      $set.collectionStatus = "collected";
      $set.collectionDate = new Date();
      $set.collectionDateAdminEdited = false;
      // Nếu không phải admin và người dùng không chỉ định assignedTo, tự gán chính mình
      if (!isAdmin && updates.assignedTo === undefined) {
        $set.assignedTo = user._id;
      }
    } else if (updates.collectionStatus === "not_collected") {
      $set.collectionStatus = "not_collected";
      $set.collectionDate = null;
      $set.collectionDateAdminEdited = false;
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ message: "Không có trường hợp lệ để cập nhật." });
    }

    const update: Record<string, unknown> = { $set };
    if (Object.keys($unset).length > 0) update.$unset = $unset;

    const result = await Invoice.updateMany({ _id: { $in: ids } }, update);

    return res.status(200).json({
      message: "Cập nhật hàng loạt thành công.",
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error("bulkUpdateInvoices error:", err);
    return res.status(500).json({ message: "Lỗi server khi cập nhật hàng loạt." });
  }
};

export const toggleInvoiceIsPaidStatus = async (req: Request, res: Response) => {  try {
    const invoiceId = req.params.invoiceId;

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return res.status(404).json({ message: "Hóa đơn không tồn tại" });

    if (!invoice.currentAmount || invoice.currentAmount.trim() === "") {
      invoice.currentAmount = "0";
    }

    if (invoice.isPaid) {
      invoice.isPaid = false;
    } else {
      invoice.isPaid = true;
    }

    await invoice.save();

    res.status(200).json(invoice);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Lỗi server" });
  }
};

export const markListInvoicesAsPaid = async (req: Request, res: Response) => {
  try {
    // Fix bug: Kiểm tra req.body.data tồn tại trước khi truy cập
    const data = req.body?.data;
    const invoiceNumbers = data?.invoiceNumbers;

    // Kiểm tra dữ liệu đầu vào
    if (!invoiceNumbers || !Array.isArray(invoiceNumbers) || invoiceNumbers.length === 0) {
      return res.status(400).json({ message: "Danh sách hóa đơn không hợp lệ" });
    }

    const filterCriteria = {
      invoiceNumber: { $in: invoiceNumbers },

      isPaid: { $ne: true },

      collectionStatus: { $ne: "collected" },
    };

    const updateOperation = [
      {
        $set: {
          isPaid: true,
        },
      },
    ];

    const result = await Invoice.updateMany(filterCriteria, updateOperation);

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Các hoá đơn trong danh sách là đã thu hoặc không có trong dữ liệu" });
    }

    res.status(200).json({
      message: "Cập nhật thành công",
      updatedCount: result.modifiedCount, // Số lượng bản ghi đã thay đổi thực tế
      matchedCount: result.matchedCount, // Số lượng bản ghi tìm thấy
    });
  } catch (err) {
    console.error("Lỗi khi cập nhật danh sách hóa đơn:", err);
    res.status(500).json({ message: "Lỗi server khi cập nhật danh sách hóa đơn" });
  }
};

export const createInvoice = async (req: Request, res: Response) => {
  try {
    const {
      invoiceNumber,
      customerName,
      customerPhone,
      customerAddress,
      billing_period,
      currentAmount,
      previousAmount,
      recordBookCode,
      assignedTo,
    } = req.body.newInvoice;

    // ✅ Kiểm tra thiếu dữ liệu
    if (!invoiceNumber || !customerName || !billing_period || !currentAmount || !previousAmount) {
      return res.status(400).json({ message: "Thiếu thông tin bắt buộc." });
    }

    // ✅ Kiểm tra hoá đơn trùng kỳ và số
    const existInvoice = await Invoice.findOne({
      invoiceNumber,
      billing_period,
    });
    if (existInvoice) {
      return res.status(409).json({ message: "Hoá đơn này của kỳ đã tồn tại." });
    }

    // Admin không tự động trở thành người phụ trách khi tạo hóa đơn
    const isAdmin = req.user?.role === "admin";
    let finalAssignedTo: any = null;
    if (assignedTo) {
      finalAssignedTo = assignedTo;
    } else if (!isAdmin) {
      finalAssignedTo = req.user?._id;
    }

    const currentAmountStr = normalizeMoneyString(currentAmount);
    const previousAmountStr = normalizeMoneyString(previousAmount);

    // ✅ Tạo bản ghi mới
    const newInvoice = new Invoice({
      invoiceNumber,
      customerName,
      customerPhone,
      customerAddress,
      billing_period,
      currentAmount: currentAmountStr,
      previousAmount: previousAmountStr,
      totalAmount: Number(currentAmountStr) + Number(previousAmountStr),
      recordBookCode: recordBookCode,
      assignedTo: finalAssignedTo,
      createdAt: new Date(),
    });

    await newInvoice.save();

    // ✅ Phản hồi chuẩn REST
    return res.status(201).json({
      message: "Tạo hoá đơn mới thành công.",
      // invoice: newInvoice,
    });
  } catch (error) {
    console.error("Lỗi khi tạo hoá đơn:", error);
    return res.status(500).json({ message: "Lỗi server khi tạo hoá đơn." });
  }
};

export const updateInvoice = async (req: Request, res: Response) => {
  const user = req.user;

  if (!user) {
    return res.status(401).json({ message: "Không xác định được người dùng" });
  }

  try {
    const {
      customerName,
      customerAddress,
      customerPhone,
      currentAmount,
      previousAmount,
      totalAmount,
      note,
      assignedTo,
      recordBookCode,
      billing_period,
    } = req.body.formData;
    const { invoiceId } = req.params;

    console.log("=== UPDATE INVOICE DEBUG ===");
    console.log("req.params:", req.params);
    console.log("req.body:", req.body);
    console.log("req.body.formData:", req.body.formData);

    // Normalize amounts to handle empty strings
    const normalizedCurrentAmount = normalizeMoneyString(currentAmount);
    const normalizedPreviousAmount = normalizeMoneyString(previousAmount);
    const normalizedTotalAmount = normalizeMoneyString(totalAmount);

    // billing_period có thể rỗng khi cập nhật (giữ nguyên kỳ cũ)
    if (!invoiceId || !customerName || !normalizedCurrentAmount || !normalizedPreviousAmount) {
      console.log("=== VALIDATION FAILED ===");
      console.log("invoiceId:", invoiceId);
      console.log("customerName:", customerName);
      console.log("normalizedCurrentAmount:", normalizedCurrentAmount);
      console.log("normalizedPreviousAmount:", normalizedPreviousAmount);
      console.log("billing_period:", billing_period);
      return res.status(400).json({ message: "Thiếu thông tin bắt buộc." });
    }

    // Kiểm tra hoá đơn tồn tại bằng _id
    const invoice = await Invoice.findById(invoiceId);

    if (!invoice) {
      return res.status(404).json({ message: "Không tìm thấy hoá đơn." });
    }

    // Xác định người phụ trách:
    // - Nếu request gửi assignedTo tường minh -> dùng giá trị đó.
    // - Ngược lại, nếu user hiện tại không phải admin -> gán cho user hiện tại.
    // - Nếu user hiện tại là admin -> GIỮ nguyên người phụ trách hiện tại.
    const isAdmin = user.role === "admin";
    let finalAssignedTo: any;
    if (assignedTo !== undefined && assignedTo !== null && assignedTo !== "") {
      finalAssignedTo = assignedTo;
    } else if (!isAdmin) {
      finalAssignedTo = req.user?._id;
    } else {
      finalAssignedTo = invoice.assignedTo;
    }

    // Cập nhật hoá đơn
    invoice.customerName = customerName;
    invoice.customerPhone = customerPhone || "";
    invoice.customerAddress = customerAddress || "";
    invoice.currentAmount = normalizeMoneyString(currentAmount);
    invoice.previousAmount = normalizeMoneyString(previousAmount);
    invoice.totalAmount = String(
      Number(normalizeMoneyString(currentAmount)) + Number(normalizeMoneyString(previousAmount))
    );
    invoice.assignedTo = finalAssignedTo;
    invoice.updateBy = new mongoose.Types.ObjectId(user._id as string);
    // Chỉ cập nhật billing_period nếu có giá trị mới hợp lệ, giữ nguyên nếu không
    invoice.billing_period = billing_period ?? invoice.billing_period;
    invoice.note = note !== undefined ? note : invoice.note;
    invoice.recordBookCode = recordBookCode;

    // console.log(invoice);

    await invoice.save();

    return res.status(200).json({ message: "Cập nhật hoá đơn thành công.", invoice });
  } catch (error) {
    console.error("Lỗi khi cập nhật hoá đơn:", error);
    return res.status(500).json({ message: "Lỗi server khi cập nhật hoá đơn." });
  }
};

export const deleteInvoice = async (req: Request, res: Response) => {
  try {
    const { invoiceId } = req.params;

    if (!invoiceId) {
      return res.status(400).json({ message: "Thiếu ID hóa đơn cần xóa" });
    }

    // Xóa hóa đơn theo _id (MongoDB ObjectId)
    const result = await Invoice.findByIdAndDelete(invoiceId);

    if (!result) {
      return res.status(404).json({ message: "Không tìm thấy hóa đơn để xóa" });
    }

    return res.status(200).json({ message: "Đã xoá hóa đơn chỉ định" });
  } catch (error) {
    console.error("Lỗi khi xoá hoá đơn:", error);
    return res.status(500).json({ message: "Lỗi server khi xoá hóa đơn" });
  }
};

export const removeInvoice = async () => {
  try {
    // Xoá toàn bộ hoá đơn có billing_period = "1"
    const result = await Invoice.deleteMany({ billing_period: "1" });

    console.log(`✅ Đã xoá ${result.deletedCount} hoá đơn có billing_period = "1".`);
  } catch (error) {
    console.error("❌ Lỗi khi xoá hoá đơn:", error);
  }
};

export const findDuplicateInvoiceNumbers = async () => {
  try {
    // Gom nhóm theo invoiceNumber và đếm số lượng từng nhóm
    const duplicates = await Invoice.aggregate([
      {
        $group: {
          _id: "$invoiceNumber",
          count: { $sum: 1 },
        },
      },
      {
        $match: {
          count: { $gt: 1 }, // chỉ lấy những invoiceNumber xuất hiện > 1 lần
        },
      },
      {
        $sort: { count: -1 }, // sắp xếp theo số lượng giảm dần (nếu muốn)
      },
    ]);

    if (duplicates.length === 0) {
      console.log("✅ Không có invoiceNumber nào bị trùng.");
    } else {
      console.log(`⚠️ Có ${duplicates.length} invoiceNumber bị trùng:`);
      duplicates.forEach((d) => {
        console.log(`- ${d._id}: ${d.count} lần`);
      });
    }

    return duplicates;
  } catch (error) {
    console.error("❌ Lỗi khi tìm invoiceNumber trùng:", error);
  }
};

export const deleteByBillingPeriod = async (req: Request, res: Response) => {
  try {
    const { billing_period } = req.query; // dạng "03/2025"

    if (!billing_period) {
      return res.status(400).json({ message: "Thiếu kỳ hoá đơn!" });
    }

    const result = await Invoice.deleteMany({ billing_period: billing_period });

    return res.status(200).json({
      message: `Đã xoá ${result.deletedCount} hoá đơn của kỳ ${billing_period}`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Lỗi xoá hoá đơn theo kỳ:", error);
    return res.status(500).json({ message: "Lỗi server khi xoá hoá đơn!" });
  }
};

// ✅ Thêm hóa đơn nhanh (Quick Add Invoice)
export const quickAddInvoice = async (req: Request, res: Response) => {
  try {
    const { invoiceNumber, customerName, totalAmount } = req.body;

    // ✅ Kiểm tra dữ liệu đầu vào
    if (!invoiceNumber || !invoiceNumber.trim()) {
      return res.status(400).json({ message: "Vui lòng nhập mã hóa đơn" });
    }

    if (!customerName || !customerName.trim()) {
      return res.status(400).json({ message: "Vui lòng nhập tên khách hàng" });
    }

    if (!totalAmount || isNaN(Number(totalAmount)) || Number(totalAmount) <= 0) {
      return res.status(400).json({ message: "Vui lòng nhập tổng tiền hợp lệ" });
    }

    const normalizedTotalAmount = normalizeMoneyString(totalAmount);
    const currentMonth = String(new Date().getMonth() + 1).padStart(2, "0");
    const currentYear = new Date().getFullYear();
    const billing_period = `${currentMonth}/${currentYear}`;

    // ✅ Cho phép nhiều hóa đơn cùng mã khách hàng trong cùng kỳ
    // (Không chặn trùng invoiceNumber + billing_period ở Quick Add)

    // ✅ Tạo bản ghi mới với dữ liệu tối thiểu
    const newInvoice = new Invoice({
      invoiceNumber: invoiceNumber.trim(),
      customerName: customerName.trim(),
      currentAmount: normalizedTotalAmount,
      previousAmount: "0",
      totalAmount: normalizedTotalAmount,
      billing_period,
      assignedTo: req.user?._id || null,
      uploadedBy: req.user?._id || null,
    });

    await newInvoice.save();

    return res.status(201).json({
      message: "Thêm hóa đơn thành công!",
      invoice: newInvoice,
    });
  } catch (error) {
    console.error("Lỗi khi thêm hóa đơn nhanh:", error);
    return res.status(500).json({ message: "Lỗi server khi thêm hóa đơn" });
  }
};
