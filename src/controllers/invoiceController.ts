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
      if (invoice.collectionStatus === "collected") {
        // Nếu đang là "đã thu" -> chuyển thành "chưa thu"
        invoice.collectionStatus = "not_collected";
        invoice.collectionDate = null; // Xóa ngày thu
        invoice.assignedTo = null; // ❌ Bỏ gán người thu
      } else {
        // Nếu đang là "chưa thu" -> chuyển thành "đã thu"
        invoice.collectionStatus = "collected";
        invoice.collectionDate = new Date(); // Ghi ngày thu hiện tại
        if (typeof req.user?.province === "string" && req.user.province.trim() !== "") {
          invoice.province = req.user.province;
        }
        invoice.assignedTo = req.user?._id as unknown as mongoose.Types.ObjectId;
      }
    }

    await invoice.save();

    res.status(200).json(invoice);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Lỗi server" });
  }
};

export const toggleInvoiceIsPaidStatus = async (req: Request, res: Response) => {
  try {
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
    const { invoiceNumbers } = req.body.data;

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
    console.error("Error updating invoices:", err);
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

    const finalAssignedTo = assignedTo || req.user?._id;

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
    const { invoiceNumber } = req.params;

    // Normalize amounts to handle empty strings
    const normalizedCurrentAmount = normalizeMoneyString(currentAmount);
    const normalizedPreviousAmount = normalizeMoneyString(previousAmount);
    const normalizedTotalAmount = normalizeMoneyString(totalAmount);

    if (!invoiceNumber || !customerName || !normalizedCurrentAmount || !normalizedPreviousAmount || !billing_period) {
      return res.status(400).json({ message: "Thiếu thông tin bắt buộc." });
    }

    // Kiểm tra hoá đơn
    const invoice = await Invoice.findOne({ invoiceNumber: invoiceNumber });

    if (!invoice) {
      return res.status(404).json({ message: "Không tìm thấy hoá đơn." });
    }

    const finalAssignedTo = assignedTo || req.user?._id;

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
    invoice.billing_period = billing_period;
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
    const { invoiceNumber } = req.params;

    // Xoá toàn bộ hoá đơn theo kỳ thanh toán
    const result = await Invoice.findByIdAndDelete(invoiceNumber);

    res.status(200).json({ message: "Đã xoá hoá đơn chỉ định" });

    // console.log("Đã xoá thành công");
  } catch (error) {
    console.error("Lỗi khi xoá hoá đơn:", error);
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

    // ✅ Kiểm tra hoá đơn trùng kỳ và số
    const existInvoice = await Invoice.findOne({
      invoiceNumber: invoiceNumber.trim(),
      billing_period,
    });

    if (existInvoice) {
      return res.status(409).json({ message: "Hóa đơn này đã tồn tại trong kỳ hiện tại" });
    }

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
