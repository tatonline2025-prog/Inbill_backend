import { Request, Response } from "express";
import mongoose from "mongoose";
import CustomerMaster from "../models/customerMasterModel";
import Invoice from "../models/invoiceModel";
import { normalizeRecordBookCode } from "../utils/recordBookCode";

const norm = (v: any) => (v === null || v === undefined ? "" : String(v).trim());
const hasVal = (v: any) => norm(v) !== "";

/**
 * Helper: upsert 1 hóa đơn vào CustomerMaster.
 * - Field tồn tại trong master mà còn rỗng → bổ sung từ invoice.
 * - Field hiện đã có giá trị → giữ nguyên (chỉ cập nhật khi truyền force=true).
 */
export const upsertCustomerMasterFromInvoice = async (inv: any, opts?: { force?: boolean }) => {
  if (!inv || !hasVal(inv.invoiceNumber)) return;
  const force = opts?.force === true;
  const invoiceNumber = norm(inv.invoiceNumber);
  const existing = await CustomerMaster.findOne({ invoiceNumber }).lean();

  const fields: Record<string, any> = {
    customerName: norm(inv.customerName),
    customerAddress: norm(inv.customerAddress),
    customerPhone: norm(inv.customerPhone),
    province: norm(inv.province),
    recordBookCode: normalizeRecordBookCode(inv.recordBookCode),
    assignedTo: inv.assignedTo || null,
  };
  const $set: Record<string, any> = {};
  if (!existing) {
    Object.entries(fields).forEach(([k, v]) => {
      if (k === "assignedTo") $set[k] = v;
      else if (hasVal(v)) $set[k] = v;
    });
    $set.lastBillingPeriod = norm(inv.billing_period);
    $set.seenCount = 1;
  } else {
    Object.entries(fields).forEach(([k, v]) => {
      if (k === "assignedTo") {
        if (force && v) $set[k] = v;
        else if (!existing.assignedTo && v) $set[k] = v;
      } else {
        if (force && hasVal(v)) $set[k] = v;
        else if (!hasVal((existing as any)[k]) && hasVal(v)) $set[k] = v;
      }
    });
    if (hasVal(inv.billing_period)) $set.lastBillingPeriod = norm(inv.billing_period);
  }
  const update: any = { $set };
  if (!existing) {
    update.$setOnInsert = { invoiceNumber };
  } else {
    update.$inc = { seenCount: 1 };
  }
  await CustomerMaster.updateOne({ invoiceNumber }, update, { upsert: true });
};

/** Bulk upsert nhiều invoice cùng lúc (dùng cho Excel import). */
export const upsertManyCustomerMasters = async (invoices: any[]) => {
  if (!Array.isArray(invoices) || invoices.length === 0) return;
  // Gom theo invoiceNumber để giảm số op
  const byCode = new Map<string, any>();
  invoices.forEach((inv) => {
    if (!hasVal(inv?.invoiceNumber)) return;
    const code = norm(inv.invoiceNumber);
    // Ưu tiên record có nhiều thông tin nhất
    const prev = byCode.get(code);
    if (!prev) byCode.set(code, inv);
    else {
      const score = (x: any) =>
        Number(hasVal(x.customerName)) +
        Number(hasVal(x.customerAddress)) +
        Number(hasVal(x.recordBookCode)) +
        Number(hasVal(x.province)) +
        Number(hasVal(x.assignedTo));
      if (score(inv) > score(prev)) byCode.set(code, inv);
    }
  });
  const codes = Array.from(byCode.keys());
  if (codes.length === 0) return;

  const existingItems = await CustomerMaster.find({ invoiceNumber: { $in: codes } })
    .select("invoiceNumber customerName customerAddress customerPhone province recordBookCode assignedTo")
    .lean();
  const existingMap = new Map(existingItems.map((item) => [norm(item.invoiceNumber), item]));

  const ops = Array.from(byCode.values()).map((inv) => {
    const invoiceNumber = norm(inv.invoiceNumber);
    const existing = existingMap.get(invoiceNumber);
    const fields: Record<string, any> = {
      customerName: norm(inv.customerName),
      customerAddress: norm(inv.customerAddress),
      customerPhone: norm(inv.customerPhone),
      province: norm(inv.province),
      recordBookCode: normalizeRecordBookCode(inv.recordBookCode),
      assignedTo: inv.assignedTo || null,
    };

    const $set: Record<string, any> = {};
    if (!existing) {
      Object.entries(fields).forEach(([key, value]) => {
        if (key === "assignedTo") $set[key] = value;
        else if (hasVal(value)) $set[key] = value;
      });
      $set.lastBillingPeriod = norm(inv.billing_period);
      $set.seenCount = 1;
    } else {
      Object.entries(fields).forEach(([key, value]) => {
        if (key === "assignedTo") {
          if (!existing.assignedTo && value) $set[key] = value;
        } else if (!hasVal((existing as any)[key]) && hasVal(value)) {
          $set[key] = value;
        }
      });
      if (hasVal(inv.billing_period)) $set.lastBillingPeriod = norm(inv.billing_period);
    }

    const update: any = { $set };
    if (!existing) {
      update.$setOnInsert = { invoiceNumber };
    } else {
      update.$inc = { seenCount: 1 };
    }

    return {
      updateOne: {
        filter: { invoiceNumber },
        update,
        upsert: true,
      },
    };
  });

  if (ops.length > 0) {
    await CustomerMaster.bulkWrite(ops, { ordered: false });
  }
};

/** GET /api/customers — list with search + pagination */
export const listCustomerMaster = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
    const search = norm(req.query.search);
    const assignedTo = norm(req.query.assignedTo);
    const province = norm(req.query.province);

    const match: any = {};
    if (search) {
      match.$or = [
        { invoiceNumber: { $regex: search, $options: "i" } },
        { customerName: { $regex: search, $options: "i" } },
        { customerAddress: { $regex: search, $options: "i" } },
        { recordBookCode: { $regex: search, $options: "i" } },
      ];
    }
    if (assignedTo) {
      if (assignedTo === "none") match.assignedTo = null;
      else if (mongoose.isValidObjectId(assignedTo)) match.assignedTo = new mongoose.Types.ObjectId(assignedTo);
    }
    if (province) match.province = province;

    const total = await CustomerMaster.countDocuments(match);
    const items = await CustomerMaster.find(match)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("assignedTo", "fullName username")
      .lean();

    return res.status(200).json({ items, total, page, limit });
  } catch (err) {
    console.error("listCustomerMaster error:", err);
    return res.status(500).json({ message: "Lỗi server khi lấy danh sách tổng." });
  }
};

/** PUT /api/customers/:id — update master fields */
export const updateCustomerMaster = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "ID không hợp lệ." });
    const allowed: Record<string, any> = {};
    const fields = ["customerName", "customerAddress", "customerPhone", "province", "recordBookCode", "note"];
    fields.forEach((f) => {
      if (f in req.body) allowed[f] = norm((req.body as any)[f]);
    });
    if ("assignedTo" in req.body) {
      const v = req.body.assignedTo;
      if (!v) allowed.assignedTo = null;
      else if (mongoose.isValidObjectId(v)) allowed.assignedTo = new mongoose.Types.ObjectId(String(v));
    }
    const updated = await CustomerMaster.findByIdAndUpdate(id, { $set: allowed }, { new: true })
      .populate("assignedTo", "fullName username")
      .lean();
    if (!updated) return res.status(404).json({ message: "Không tìm thấy bản ghi." });
    return res.status(200).json({ item: updated });
  } catch (err) {
    console.error("updateCustomerMaster error:", err);
    return res.status(500).json({ message: "Lỗi server khi cập nhật." });
  }
};

/** DELETE /api/customers/:id */
export const deleteCustomerMaster = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "ID không hợp lệ." });
    const r = await CustomerMaster.findByIdAndDelete(id);
    if (!r) return res.status(404).json({ message: "Không tìm thấy bản ghi." });
    return res.status(200).json({ message: "Đã xóa." });
  } catch (err) {
    console.error("deleteCustomerMaster error:", err);
    return res.status(500).json({ message: "Lỗi server khi xóa." });
  }
};

/**
 * POST /api/customers/:id/create-invoice
 * Body: { totalAmount, currentAmount?, previousAmount?, billing_period }
 * Quy tắc:
 *  - billing_period bắt buộc.
 *  - totalAmount bắt buộc, > 0.
 *  - previousAmount để trống / 0 → currentAmount = totalAmount = totalAmount nhập vào.
 *  - currentAmount không nhập → currentAmount = totalAmount - previousAmount.
 *  - Lấy thông tin KH (tên, địa chỉ, trạm, NPT, tỉnh) từ master.
 */
export const createInvoiceFromMaster = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "ID không hợp lệ." });
    const master = await CustomerMaster.findById(id).lean();
    if (!master) return res.status(404).json({ message: "Không tìm thấy KH trong danh sách tổng." });

    const billing_period = norm(req.body.billing_period);
    if (!billing_period) return res.status(400).json({ message: "Thiếu kỳ thanh toán." });
    const totalNum = Number(String(req.body.totalAmount ?? "").replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(totalNum) || totalNum <= 0) {
      return res.status(400).json({ message: "Tổng tiền phải > 0." });
    }
    let prevNum = Number(String(req.body.previousAmount ?? "").replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(prevNum) || prevNum < 0) prevNum = 0;
    let curNum = Number(String(req.body.currentAmount ?? "").replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(curNum) || curNum <= 0) curNum = Math.max(0, totalNum - prevNum);
    if (prevNum === 0) curNum = totalNum;

    // Chống trùng (invoiceNumber + billing_period + assignedTo)
    const dupFilter: any = {
      invoiceNumber: master.invoiceNumber,
      billing_period,
      assignedTo: master.assignedTo ?? null,
    };
    const existed = await Invoice.findOne(dupFilter).lean();
    if (existed) {
      return res.status(409).json({
        message: `Hóa đơn ${master.invoiceNumber} (kỳ ${billing_period}) đã tồn tại.`,
        duplicate: true,
      });
    }

    const created = await Invoice.create({
      invoiceNumber: master.invoiceNumber,
      customerName: master.customerName || "",
      customerAddress: master.customerAddress || "",
      customerPhone: master.customerPhone || "",
      province: master.province || "",
      recordBookCode: master.recordBookCode || "",
      assignedTo: master.assignedTo || null,
      billing_period,
      currentAmount: String(Math.trunc(curNum)),
      previousAmount: String(Math.trunc(prevNum)),
      totalAmount: String(Math.trunc(totalNum)),
      issueDate: new Date(),
      sortPriority: 1,
    });
    // Cập nhật lastBillingPeriod
    await CustomerMaster.updateOne({ _id: master._id }, { $set: { lastBillingPeriod: billing_period }, $inc: { seenCount: 1 } });

    return res.status(201).json({ message: "Đã tạo hóa đơn từ danh sách tổng.", invoice: created });
  } catch (err) {
    console.error("createInvoiceFromMaster error:", err);
    return res.status(500).json({ message: "Lỗi server khi tạo hóa đơn." });
  }
};

/**
 * POST /api/customers/sync-from-invoices
 * Quét toàn bộ Invoice và đảm bảo CustomerMaster có đầy đủ.
 */
export const syncCustomerMasterFromInvoices = async (_req: Request, res: Response) => {
  try {
    const invoices = await Invoice.find({}).lean();
    await upsertManyCustomerMasters(invoices);
    const total = await CustomerMaster.countDocuments();
    return res.status(200).json({ message: `Đã đồng bộ ${invoices.length} hóa đơn. Danh sách tổng hiện có ${total} KH.`, total });
  } catch (err) {
    console.error("syncCustomerMasterFromInvoices error:", err);
    return res.status(500).json({ message: "Lỗi server khi đồng bộ." });
  }
};
