import { Request, Response } from "express";
import mongoose from "mongoose";
import CustomerMaster from "../models/customerMasterModel";
import Invoice from "../models/invoiceModel";
import { normalizeRecordBookCode } from "../utils/recordBookCode";
import { normalizeMoneyString, parseMoneyNumber, resolveInvoiceAmounts } from "../utils/money";
import { JwtPayload } from "../types/jwtPayload";
import { activityChanges, ownsRecord, recordUserActivity } from "../utils/userActivity";

const norm = (v: any) => (v === null || v === undefined ? "" : String(v).trim());
const hasVal = (v: any) => norm(v) !== "";

/**
 * Helper: upsert 1 hóa đơn vào CustomerMaster.
 * - Field tồn tại trong master mà còn rỗng → bổ sung từ invoice.
 * - Field hiện đã có giá trị → giữ nguyên (chỉ cập nhật khi truyền force=true).
 */
export const upsertCustomerMasterFromInvoice = async (inv: any, opts?: { force?: boolean; actor?: JwtPayload }) => {
  if (!inv || !hasVal(inv.invoiceNumber)) return;
  const force = opts?.force === true;
  const invoiceNumber = norm(inv.invoiceNumber);
  const existing = await CustomerMaster.findOne({ invoiceNumber }).lean();
  if (opts?.actor && existing && !ownsRecord(opts.actor, existing)) return;

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
        if (force) $set[k] = v;
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
  const ownerScope = opts?.actor && opts.actor.role !== "admin" ? { assignedTo: opts.actor._id } : {};
  await CustomerMaster.updateOne({ invoiceNumber, ...ownerScope }, update, { upsert: !existing });
};

/** Bulk upsert nhiều invoice cùng lúc (dùng cho Excel import). */
export const upsertManyCustomerMasters = async (invoices: any[], opts?: { actor?: JwtPayload }) => {
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

  const ops = Array.from(byCode.values()).filter((inv) => {
    const existing = existingMap.get(norm(inv.invoiceNumber));
    return !opts?.actor || !existing || ownsRecord(opts.actor, existing);
  }).map((inv) => {
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
        filter: { invoiceNumber, ...(opts?.actor && opts.actor.role !== "admin" ? { assignedTo: opts.actor._id } : {}) },
        update,
        upsert: !existing,
      },
    };
  });

  if (ops.length > 0) {
    await CustomerMaster.bulkWrite(ops, { ordered: false });
  }
};

/** GET /api/customers — list with search + pagination */
export const listCustomerMaster = async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ message: "Chưa đăng nhập." });
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
    if (req.user.role !== "admin") {
      match.assignedTo = new mongoose.Types.ObjectId(req.user._id);
    } else if (assignedTo) {
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
  if (!req.user) return res.status(401).json({ message: "Chưa đăng nhập." });
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "ID không hợp lệ." });
    const existing = await CustomerMaster.findById(id).lean();
    if (!existing) return res.status(404).json({ message: "Không tìm thấy khách hàng." });
    if (!ownsRecord(req.user, existing)) return res.status(403).json({ message: "Bạn chỉ được sửa khách hàng của mình." });
    const allowed: Record<string, any> = {};
    const fields = ["customerName", "customerAddress", "customerPhone", "province", "recordBookCode", "note"];
    fields.forEach((f) => {
      if (f in req.body) allowed[f] = f === "recordBookCode" ? normalizeRecordBookCode(req.body[f]) : norm(req.body[f]);
    });
    if ("assignedTo" in req.body) {
      const v = req.body.assignedTo;
      if (req.user.role !== "admin" && v !== undefined && String(v || "") !== String(req.user._id)) {
        return res.status(403).json({ message: "Bạn không được chuyển khách hàng cho tài khoản khác." });
      }
      if (!v) allowed.assignedTo = null;
      else if (mongoose.isValidObjectId(v)) allowed.assignedTo = new mongoose.Types.ObjectId(String(v));
    }
    const updated = await CustomerMaster.findOneAndUpdate({ _id: id,
      ...(req.user.role !== "admin" ? { assignedTo: req.user._id } : {}) }, { $set: allowed }, { new: true, runValidators: true })
      .populate("assignedTo", "fullName username")
      .lean();
    if (!updated) return res.status(404).json({ message: "Không tìm thấy bản ghi." });
    if (req.user.role !== "admin") {
      const customerFields: Record<string, unknown> = {};
      ["customerName", "customerAddress", "customerPhone", "recordBookCode"].forEach((field) => {
        if (field in allowed) customerFields[field] = allowed[field];
      });
      if (Object.keys(customerFields).length) await Invoice.updateMany(
        { invoiceNumber: updated.invoiceNumber, assignedTo: req.user._id }, { $set: customerFields });
    }
    const changes = activityChanges(existing, updated);
    if (changes.length) await recordUserActivity(req.user, "customer_updated", { entityId: updated._id,
      customerCode: updated.invoiceNumber, message: `Cập nhật khách hàng ${updated.invoiceNumber} — ${updated.customerName}.`, changes });
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
  if (!req.user) return res.status(401).json({ message: "Chưa đăng nhập." });
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "ID không hợp lệ." });
    const master = await CustomerMaster.findById(id).lean();
    if (!master) return res.status(404).json({ message: "Không tìm thấy KH trong danh sách tổng." });
    if (!ownsRecord(req.user, master)) return res.status(403).json({ message: "Bạn chỉ được thêm hóa đơn cho khách hàng của mình." });

    const billing_period = norm(req.body.billing_period);
    if (!billing_period) return res.status(400).json({ message: "Thiếu kỳ thanh toán." });
    const resolvedAmounts = resolveInvoiceAmounts({ totalAmount: req.body.totalAmount,
      previousAmount: req.body.previousAmount, currentAmount: req.body.currentAmount });
    const totalNum = parseMoneyNumber(resolvedAmounts.totalAmount);
    if (!Number.isFinite(totalNum) || totalNum <= 0) {
      return res.status(400).json({ message: "Tổng tiền phải > 0." });
    }
    const prevNum = parseMoneyNumber(resolvedAmounts.previousAmount);
    const curNum = parseMoneyNumber(resolvedAmounts.currentAmount);

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
      recordBookCode: normalizeRecordBookCode(master.recordBookCode),
      assignedTo: master.assignedTo || null,
      billing_period,
      currentAmount: normalizeMoneyString(curNum),
      previousAmount: normalizeMoneyString(prevNum),
      totalAmount: normalizeMoneyString(totalNum),
      issueDate: new Date(),
      sortPriority: 1,
      uploadedBy: req.user._id,
    });
    // Cập nhật lastBillingPeriod
    await CustomerMaster.updateOne({ _id: master._id, ...(req.user.role !== "admin" ? { assignedTo: req.user._id } : {}) }, { $set: { lastBillingPeriod: billing_period }, $inc: { seenCount: 1 } });
    await recordUserActivity(req.user, "invoice_created", { entityId: created._id, customerCode: created.invoiceNumber,
      message: `Thêm hóa đơn ${created.invoiceNumber} từ khách hàng của mình.`, details: { billingPeriod: billing_period, totalAmount: created.totalAmount } });

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
