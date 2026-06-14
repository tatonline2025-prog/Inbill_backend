import { Request, Response } from "express";
import Invoice, { IInvoice } from "../models/invoiceModel";
import User, { IUser } from "../models/userModel";
import { upsertCustomerMasterFromInvoice } from "./customerMasterController";
import mongoose from "mongoose";
import {
  didBecomeCollected,
  queueCollectedInvoiceNotifications,
} from "../utils/collectionNotifications";
import { parseMoneyNumber, resolveInvoiceAmounts } from "../utils/money";
import { normalizeRecordBookCode } from "../utils/recordBookCode";

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

const parseCollectionDateInput = (value: unknown): Date | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;

  const parsed = new Date(`${raw}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed;
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
    const beforeCollectionStatus = invoice.collectionStatus;

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
        // Admin không trở thành người phụ trách; user thường đã thu sau cùng sẽ là người phụ trách
        if (!isAdmin) {
          invoice.assignedTo = req.user?._id as unknown as mongoose.Types.ObjectId;
        }
      }
    }

    const shouldNotifyCollected = didBecomeCollected(beforeCollectionStatus, invoice.collectionStatus);

    await invoice.save();

    if (field === "collectionStatus" && shouldNotifyCollected) {
      queueCollectedInvoiceNotifications([invoice.toObject()], req.user, "toggle_invoice_status");
    }

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
    const beforeCollectionStatus = invoice.collectionStatus;

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

    const shouldNotifyCollected = didBecomeCollected(beforeCollectionStatus, invoice.collectionStatus);

    await invoice.save();
    if (shouldNotifyCollected) {
      queueCollectedInvoiceNotifications([invoice.toObject()], req.user, "admin_update_collection_date");
    }
    return res.status(200).json(invoice);
  } catch (err) {
    console.error("updateCollectionDateByAdmin error:", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

/**
 * Cập nhật hàng loạt cho các hóa đơn được chọn.
 * PATCH /api/invoices/bulk-update
 * body: { ids: string[], updates: { recordBookCode?, assignedTo?, billing_period?, collectionStatus?, collectionDate? } }
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
        collectionDate?: string | null;
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
      $set.recordBookCode = normalizeRecordBookCode(updates.recordBookCode);
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

    if (updates.collectionDate !== undefined) {
      if (!isAdmin) {
        return res.status(403).json({ message: "Chá»‰ admin Ä‘Æ°á»£c phÃ©p cáº­p nháº­t ngÃ y thu hÃ ng loáº¡t." });
      }

      if (updates.collectionDate === null || updates.collectionDate === "") {
        $set.collectionStatus = "not_collected";
        $set.collectionDate = null;
        $set.collectionDateAdminEdited = false;
      } else {
        const parsedCollectionDate = parseCollectionDateInput(updates.collectionDate);
        if (!parsedCollectionDate) {
          return res.status(400).json({ message: "NgÃ y thu khÃ´ng há»£p lá»‡ (YYYY-MM-DD)." });
        }

        $set.collectionStatus = "collected";
        $set.collectionDate = parsedCollectionDate;
        $set.collectionDateAdminEdited = true;
      }
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ message: "Không có trường hợp lệ để cập nhật." });
    }

    const update: Record<string, unknown> = { $set };
    if (Object.keys($unset).length > 0) update.$unset = $unset;

    const beforeInvoices = await Invoice.find({ _id: { $in: ids } }).lean();
    const result = await Invoice.updateMany({ _id: { $in: ids } }, update);
    const afterInvoices = await Invoice.find({ _id: { $in: ids } }).lean();

    const beforeMap = new Map(beforeInvoices.map((invoice) => [String(invoice._id), invoice]));
    const collectedInvoices = afterInvoices.filter((invoice) => {
      const beforeInvoice = beforeMap.get(String(invoice._id));
      return didBecomeCollected(beforeInvoice?.collectionStatus, invoice.collectionStatus);
    });

    if (collectedInvoices.length > 0) {
      queueCollectedInvoiceNotifications(collectedInvoices, req.user, "bulk_update_invoices");
    }

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

/**
 * Đồng bộ thông tin giữa các hóa đơn cùng invoiceNumber (giống mã KH):
 * - Với mỗi field text (customerName, customerAddress, recordBookCode, customerPhone),
 *   nếu một bản ghi đang trống mà bản ghi cùng invoiceNumber có giá trị → copy qua.
 * - KHÔNG động đến: collectionStatus, collectionDate, isPaid, printStatus, billing_period, assignedTo, currentAmount/previousAmount/totalAmount.
 */
export const syncDuplicateInvoiceInfo = async (_req: Request, res: Response) => {
  try {
    const FIELDS = ["customerName", "customerAddress", "recordBookCode", "customerPhone"] as const;
    const isEmpty = (v: any) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

    // 1) Lấy danh sách invoiceNumber bị trùng (>=2 bản ghi)
    const dupAgg = await Invoice.aggregate([
      { $match: { invoiceNumber: { $nin: [null, ""] } } },
      { $group: { _id: "$invoiceNumber", c: { $sum: 1 } } },
      { $match: { c: { $gt: 1 } } },
      { $project: { _id: 1 } },
    ]);
    const dupNums = dupAgg.map((d: any) => d._id);
    if (dupNums.length === 0) {
      return res.status(200).json({ message: "Không có nhóm giống mã KH nào để đồng bộ.", scanned: 0, updated: 0 });
    }

    // 2) Lấy tất cả hóa đơn thuộc các invoiceNumber trùng
    const invoices = await Invoice.find({ invoiceNumber: { $in: dupNums } }).lean();

    // 3) Group theo invoiceNumber, tìm best value cho mỗi field
    const groups = new Map<string, any[]>();
    invoices.forEach((inv: any) => {
      const arr = groups.get(inv.invoiceNumber) || [];
      arr.push(inv);
      groups.set(inv.invoiceNumber, arr);
    });

    const ops: any[] = [];
    groups.forEach((rows) => {
      const best: Record<string, any> = {};
      for (const f of FIELDS) {
        const found = rows.find((r) => !isEmpty(r[f]));
        if (found) best[f] = found[f];
      }
      // Update các bản ghi đang rỗng ở field tương ứng
      rows.forEach((r) => {
        const $set: Record<string, any> = {};
        for (const f of FIELDS) {
          if (isEmpty(r[f]) && best[f] !== undefined) {
            $set[f] = best[f];
          }
        }
        if (Object.keys($set).length > 0) {
          ops.push({ updateOne: { filter: { _id: r._id }, update: { $set } } });
        }
      });
    });

    if (ops.length === 0) {
      return res.status(200).json({
        message: "Các nhóm giống mã KH đã được đồng bộ, không có gì cần bổ sung thêm.",
        scanned: invoices.length,
        updated: 0,
      });
    }
    const result = await Invoice.bulkWrite(ops, { ordered: false });
    return res.status(200).json({
      message: `Đã đồng bộ thông tin cho ${result.modifiedCount ?? 0} hóa đơn trong ${invoices.length} bản ghi giống mã KH.`,
      scanned: invoices.length,
      updated: result.modifiedCount ?? 0,
    });
  } catch (err) {
    console.error("syncDuplicateInvoiceInfo error:", err);
    return res.status(500).json({ message: "Lỗi máy chủ khi đồng bộ các nhóm giống mã KH." });
  }
};

/**
 * Dọn các hóa đơn TRÙNG mã KH đã đồng bộ giống nhau hết:
 * Trong nhóm cùng (invoiceNumber, billing_period), nếu nội dung (tên, địa chỉ, mã trạm, số tiền, NPT) giống hệt nhau,
 * thì xóa các bản ghi CHƯA tương tác (collectionStatus=not_collected, isPaid≠true, printStatus≠printed, không có collectionDate),
 * giữ lại bản ghi có ít nhất một tương tác. Nếu cả nhóm đều chưa tương tác → giữ 1 bản.
 */
export const cleanupRedundantDuplicates = async (_req: Request, res: Response) => {
  try {
    const isUntouched = (inv: any) =>
      (!inv.collectionStatus || inv.collectionStatus === "not_collected") &&
      inv.isPaid !== true &&
      (!inv.printStatus || inv.printStatus !== "printed") &&
      (inv.collectionDate === null || inv.collectionDate === undefined);

    // Lấy nhóm có invoiceNumber + billing_period trùng (>=2 bản ghi)
    const dupAgg = await Invoice.aggregate([
      { $match: { invoiceNumber: { $nin: [null, ""] } } },
      { $group: { _id: { invoiceNumber: "$invoiceNumber", billing_period: "$billing_period" }, c: { $sum: 1 } } },
      { $match: { c: { $gt: 1 } } },
    ]);
    if (dupAgg.length === 0) {
      return res.status(200).json({ message: "Không có nhóm nào để dọn.", deleted: 0 });
    }

    const orFilter = dupAgg.map((d: any) => ({
      invoiceNumber: d._id.invoiceNumber,
      billing_period: d._id.billing_period,
    }));
    const all = await Invoice.find({ $or: orFilter }).lean();

    // Group theo (invoiceNumber + billing_period)
    const groups = new Map<string, any[]>();
    all.forEach((inv: any) => {
      const k = `${inv.invoiceNumber}__${inv.billing_period}`;
      const arr = groups.get(k) || [];
      arr.push(inv);
      groups.set(k, arr);
    });

    const idsToDelete: any[] = [];
    const deletedSet = new Set<string>();
    const markDel = (r: any) => {
      const id = String(r._id);
      if (deletedSet.has(id)) return;
      deletedSet.add(id);
      idsToDelete.push(r._id);
    };
    const norm = (v: any) => (v === null || v === undefined ? "" : String(v).trim());
    const hasAssignee = (r: any) => norm(r.assignedTo) !== "";
    groups.forEach((rows) => {
      // Sig KHÔNG bao gồm assignedTo — coi 2 bản ghi là "giống nhau" kể cả khi 1 cái có NPT, 1 cái không.
      const sig = (r: any) =>
        [
          norm(r.customerName),
          norm(r.customerAddress),
          norm(r.recordBookCode),
          norm(r.currentAmount),
          norm(r.previousAmount),
          norm(r.totalAmount),
        ].join("||");
      const first = sig(rows[0]);
      const allSame = rows.every((r) => sig(r) === first);
      if (!allSame) return;

      // BƯỚC 1: nếu trong nhóm có cả bản có NPT và không NPT → xóa các bản không NPT (chưa tương tác)
      const withAssignee = rows.filter(hasAssignee);
      const withoutAssignee = rows.filter((r) => !hasAssignee(r));
      let remaining = rows;
      if (withAssignee.length > 0 && withoutAssignee.length > 0) {
        withoutAssignee.filter(isUntouched).forEach(markDel);
        remaining = rows.filter((r) => !deletedSet.has(String(r._id)));
      }

      // BƯỚC 2: trong các bản còn lại, dọn theo NPT
      const byAssignee = new Map<string, any[]>();
      remaining.forEach((r) => {
        const k = norm(r.assignedTo);
        const arr = byAssignee.get(k) || [];
        arr.push(r);
        byAssignee.set(k, arr);
      });
      byAssignee.forEach((sub) => {
        if (sub.length < 2) return;
        const touched = sub.filter((r) => !isUntouched(r));
        const untouched = sub.filter((r) => isUntouched(r));
        if (touched.length > 0) {
          untouched.forEach(markDel);
        } else {
          untouched.slice(1).forEach(markDel);
        }
      });
    });

    if (idsToDelete.length === 0) {
      return res.status(200).json({ message: "Không có hóa đơn trùng nào cần xóa.", deleted: 0 });
    }
    const result = await Invoice.deleteMany({ _id: { $in: idsToDelete } });
    return res.status(200).json({
      message: `Đã xóa ${result.deletedCount ?? 0} hóa đơn trùng thực sự (giống hệt và chưa tương tác).`,
      deleted: result.deletedCount ?? 0,
    });
  } catch (err) {
    console.error("cleanupRedundantDuplicates error:", err);
    return res.status(500).json({ message: "Lỗi máy chủ khi dọn hóa đơn trùng." });
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
      totalAmount,
      recordBookCode,
      assignedTo,
    } = req.body.newInvoice;

    const resolvedAmounts = resolveInvoiceAmounts({
      currentAmount,
      previousAmount,
      totalAmount,
    });

    // ✅ Kiểm tra thiếu dữ liệu
    if (!invoiceNumber || !customerName || !billing_period || !resolvedAmounts.hasAnyAmount) {
      return res.status(400).json({ message: "Thiếu thông tin bắt buộc." });
    }

    // Admin không tự động trở thành người phụ trách khi tạo hóa đơn
    const isAdmin = req.user?.role === "admin";
    let finalAssignedTo: any = null;
    if (assignedTo) {
      finalAssignedTo = assignedTo;
    } else if (!isAdmin) {
      finalAssignedTo = req.user?._id;
    }

    const currentAmountStr = resolvedAmounts.currentAmount;
    const previousAmountStr = resolvedAmounts.previousAmount;
    const totalAmountStr = resolvedAmounts.totalAmount;

    // ✅ Trùng khóa gộp (Mã KH + Kỳ TT + Người phụ trách) → CHẶN, cảnh báo cho admin.
    const existInvoice = await Invoice.findOne({
      invoiceNumber,
      billing_period,
      assignedTo: finalAssignedTo,
    });
    if (existInvoice) {
      return res.status(409).json({
        message: `Hóa đơn ${invoiceNumber} (kỳ ${billing_period}) cho người phụ trách này đã tồn tại — vui lòng kiểm tra/chỉnh sửa hóa đơn cũ thay vì thêm mới.`,
        duplicate: true,
      });
    }

    // ✅ Tạo bản ghi mới
    const newInvoice = new Invoice({
      invoiceNumber,
      customerName,
      customerPhone,
      customerAddress,
      billing_period,
      currentAmount: currentAmountStr,
      previousAmount: previousAmountStr,
      totalAmount: totalAmountStr,
      recordBookCode: normalizeRecordBookCode(recordBookCode),
      assignedTo: finalAssignedTo,
      createdAt: new Date(),
    });

    await newInvoice.save();

    // Đồng bộ vào danh sách tổng (không chặn flow chính)
    try { await upsertCustomerMasterFromInvoice(newInvoice.toObject()); } catch (e) { console.error("upsert master (create) err:", e); }

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

    const resolvedAmounts = resolveInvoiceAmounts({
      currentAmount,
      previousAmount,
      totalAmount,
    });

    // billing_period có thể rỗng khi cập nhật (giữ nguyên kỳ cũ)
    if (!invoiceId || !customerName || !resolvedAmounts.hasAnyAmount) {
      console.log("=== VALIDATION FAILED ===");
      console.log("invoiceId:", invoiceId);
      console.log("customerName:", customerName);
      console.log("normalizedCurrentAmount:", resolvedAmounts.currentAmount);
      console.log("normalizedPreviousAmount:", resolvedAmounts.previousAmount);
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
    invoice.currentAmount = resolvedAmounts.currentAmount;
    invoice.previousAmount = resolvedAmounts.previousAmount;
    invoice.totalAmount = resolvedAmounts.totalAmount;
    invoice.assignedTo = finalAssignedTo;
    invoice.updateBy = new mongoose.Types.ObjectId(user._id as string);
    // Chỉ cập nhật billing_period nếu có giá trị mới hợp lệ, giữ nguyên nếu không
    invoice.billing_period = billing_period ?? invoice.billing_period;
    invoice.note = note !== undefined ? note : invoice.note;
    invoice.recordBookCode = normalizeRecordBookCode(recordBookCode);

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

    // Lưu vào danh sách tổng trước khi mất (không chặn)
    try { await upsertCustomerMasterFromInvoice(result.toObject()); } catch (e) { console.error("upsert master (delete) err:", e); }

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
    const { invoiceNumber, customerName, totalAmount, recordBookCode } = req.body;

    // ✅ Kiểm tra dữ liệu đầu vào
    if (!invoiceNumber || !invoiceNumber.trim()) {
      return res.status(400).json({ message: "Vui lòng nhập mã hóa đơn" });
    }

    if (!customerName || !customerName.trim()) {
      return res.status(400).json({ message: "Vui lòng nhập tên khách hàng" });
    }

    const resolvedAmounts = resolveInvoiceAmounts({ totalAmount });
    if (!resolvedAmounts.hasAnyAmount || parseMoneyNumber(resolvedAmounts.totalAmount) <= 0) {
      return res.status(400).json({ message: "Vui lòng nhập tổng tiền hợp lệ" });
    }

    const currentMonth = String(new Date().getMonth() + 1).padStart(2, "0");
    const currentYear = new Date().getFullYear();
    const billing_period = `${currentMonth}/${currentYear}`;

    // ✅ Cho phép nhiều hóa đơn cùng mã khách hàng trong cùng kỳ
    // (Không chặn trùng invoiceNumber + billing_period ở Quick Add)

    // ✅ Tạo bản ghi mới với dữ liệu tối thiểu
    const newInvoice = new Invoice({
      invoiceNumber: invoiceNumber.trim(),
      customerName: customerName.trim(),
      currentAmount: resolvedAmounts.currentAmount,
      previousAmount: resolvedAmounts.previousAmount,
      totalAmount: resolvedAmounts.totalAmount,
      recordBookCode: normalizeRecordBookCode(recordBookCode),
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

export const deleteInvoicesByBillingPeriodAndAssignedUser = async (req: Request, res: Response) => {
  try {
    const { billing_period, assignedUserId } = req.query;

    if (!billing_period) {
      return res.status(400).json({ message: "Thiếu kỳ hóa đơn!" });
    }

    const filter: Record<string, unknown> = {
      billing_period: String(billing_period).trim(),
    };

    if (assignedUserId && assignedUserId !== "all") {
      if (assignedUserId === "no_one") {
        filter.$or = [{ assignedTo: { $exists: false } }, { assignedTo: null }, { assignedTo: "" }];
      } else if (mongoose.Types.ObjectId.isValid(String(assignedUserId))) {
        filter.assignedTo = new mongoose.Types.ObjectId(String(assignedUserId));
      } else {
        return res.status(400).json({ message: "Người phụ trách không hợp lệ." });
      }
    }

    const result = await Invoice.deleteMany(filter);

    return res.status(200).json({
      message:
        assignedUserId && assignedUserId !== "all"
          ? `Đã xoá ${result.deletedCount} hoá đơn của kỳ ${billing_period} theo người phụ trách đã chọn`
          : `Đã xoá ${result.deletedCount} hoá đơn của kỳ ${billing_period}`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("deleteInvoicesByBillingPeriodAndAssignedUser error:", error);
    return res.status(500).json({ message: "Lỗi server khi xoá hoá đơn!" });
  }
};
