import { Request, Response } from "express";
import * as XLSX from "xlsx";
import Invoice, { IInvoice } from "../models/invoiceModel";
import { IUser } from "../models/userModel";

export const previewExcel = async (req: Request, res: Response) => {
  const now = new Date();
  let month = now.getMonth();
  let year = now.getFullYear();

  if (month === 0) {
    month = 12;
    year -= 1;
  }

  const billing_period = `${month.toString().padStart(2, "0")}/${year}`;

  try {
    if (!req.file) {
      return res.status(400).json({ message: "Không tìm thấy file nào được tải lên." });
    }

    const { userId } = req.body;

    const columnMapping = {
      "Mã khách hàng": "invoiceNumber",
      Tên: "customerName",
      "Địa chỉ": "customerAddress",
      "Tổng tiền": "totalAmount",
      "Kỳ này": "currentAmount",
      "Kỳ trước": "previousAmount",
      // "Số ĐT KH": "customerPhone",
    };

    const fileBuffer = req.file.buffer;
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

    // Tạo danh sách hóa đơn
    const documentsToCreate = jsonData
      .map((row) => {
        const newDoc: any = {
          billing_period,
          assignedTo: userId,
          issueDate: new Date(),
        };

        for (const excelHeader in columnMapping) {
          if (row[excelHeader] !== undefined) {
            const dbField = columnMapping[excelHeader as keyof typeof columnMapping];
            newDoc[dbField] = row[excelHeader];
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
          billing_period: doc.billing_period,
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

export const previewExcelProvince = async (req: Request, res: Response) => {
  const now = new Date();
  let month = now.getMonth();
  let year = now.getFullYear();

  if (month === 0) {
    month = 12;
    year -= 1;
  }

  const billing_period = `${month.toString().padStart(2, "0")}/${year}`;

  try {
    if (!req.file) {
      return res.status(400).json({ message: "Không tìm thấy file nào được tải lên." });
    }

    const columnMapping = {
      "Mã khách hàng": "invoiceNumber",
      Tên: "customerName",
      "Địa chỉ": "customerAddress",
      "Tổng tiền": "totalAmount",
      "Kỳ này": "currentAmount",
      "Kỳ trước": "previousAmount",
    };

    const fileBuffer = req.file.buffer;
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

    console.log("Excel raw data:", jsonData);

    const documentsToCreate = jsonData
      .map((row) => {
        const newDoc: any = {
          billing_period,
          issueDate: new Date(),
          province: req.body.province, // 🔹 Gán province vào mỗi hóa đơn nếu cần
        };

        for (const excelHeader in columnMapping) {
          if (row[excelHeader] !== undefined) {
            const dbField = columnMapping[excelHeader as keyof typeof columnMapping];
            newDoc[dbField] = row[excelHeader];
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
          billing_period: doc.billing_period,
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

export const fetchallInvoice = async (req: Request, res: Response) => {
  const now = new Date();
  let month = now.getMonth();
  let year = now.getFullYear();

  if (month === 0) {
    month = 12;
    year -= 1;
  }

  const billing_period = `${month.toString().padStart(2, "0")}/${year}`;

  const result = await Invoice.find({ billing_period })
    .populate("assignedTo", "fullName email") // Nếu muốn lấy thêm thông tin người được chỉ định
    .sort({ billing_period: -1 });

  res.status(200).json(result);
};

export const getInvoiceSummary = async (req: Request, res: Response) => {
  try {
    // Dùng aggregate để tính tổng hợp
    const result = await Invoice.aggregate([
      {
        $lookup: {
          from: "users",
          let: { userId: "$assignedTo" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$userId"] } } },
            {
              $project: {
                password: 0, // loại password nếu tên field là "password"
                pass: 0, // hoặc "pass" nếu bạn có field đó
                __v: 0, // bỏ __v nếu muốn
              },
            },
          ],
          as: "assignedTo",
        },
      },
      { $unwind: { path: "$assignedTo", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: {
            billing_period: "$billing_period",
            assignedTo: "$assignedTo._id",
          },
          billing_period: { $first: "$billing_period" },
          assignedTo: { $first: "$assignedTo" },
          collectedCount: {
            $sum: { $cond: [{ $eq: ["$collectionStatus", "collected"] }, 1, 0] },
          },
          notCollectedCount: {
            $sum: { $cond: [{ $eq: ["$collectionStatus", "not_collected"] }, 1, 0] },
          },
          collectedTotal: {
            $sum: {
              $cond: [
                { $eq: ["$collectionStatus", "collected"] },
                { $convert: { input: "$totalAmount", to: "double", onError: 0, onNull: 0 } },
                0,
              ],
            },
          },
          notCollectedTotal: {
            $sum: {
              $cond: [
                { $eq: ["$collectionStatus", "not_collected"] },
                { $convert: { input: "$totalAmount", to: "double", onError: 0, onNull: 0 } },
                0,
              ],
            },
          },
        },
      },
      {
        // ✅ Sắp xếp cho dễ nhìn: theo kỳ mới nhất
        $sort: { billing_period: -1 },
      },
    ]);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error in getInvoiceSummary:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const fetchInvoiceByUser = async (req: Request, res: Response) => {
  try {
    // 1️⃣ Kiểm tra xác thực người dùng
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: "Bạn chưa đăng nhập hoặc token không hợp lệ.",
      });
    }

    // 2️⃣ Lấy danh sách hoá đơn của người dùng
    const invoices = await Invoice.find({ assignedTo: req.user._id })
      .populate("assignedTo", "fullName email") // Nếu muốn lấy thêm thông tin người được chỉ định
      .sort({ billing_period: -1 });

    // 4️⃣ Trả về dữ liệu
    res.status(200).json(invoices);
  } catch (error) {
    console.error("Lỗi khi lấy hoá đơn:", error);
    res.status(500).json({
      success: false,
      message: "Đã có lỗi xảy ra khi lấy dữ liệu hoá đơn.",
      error: (error as Error).message,
    });
  }
};

export const fetchInvoiceByUserMonth = async (req: Request, res: Response) => {
  const now = new Date();
  let month = now.getMonth();
  let year = now.getFullYear();

  if (month === 0) {
    month = 12;
    year -= 1;
  }

  const billing_period = `${month.toString().padStart(2, "0")}/${year}`;

  try {
    // 1️⃣ Kiểm tra xác thực người dùng
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: "Bạn chưa đăng nhập hoặc token không hợp lệ.",
      });
    }

    // 2️⃣ Lấy danh sách hoá đơn của người dùng
    const invoices = await Invoice.find({ assignedTo: req.user._id, billing_period })
      .populate("assignedTo", "fullName email") // Nếu muốn lấy thêm thông tin người được chỉ định
      .sort({ billing_period: -1 });

    // 4️⃣ Trả về dữ liệu
    res.status(200).json(invoices);
  } catch (error) {
    console.error("Lỗi khi lấy hoá đơn:", error);
    res.status(500).json({
      success: false,
      message: "Đã có lỗi xảy ra khi lấy dữ liệu hoá đơn.",
      error: (error as Error).message,
    });
  }
};

export const fetchAllUnColInvoiceByUser = async (req: Request, res: Response) => {
  try {
    // 1️⃣ Kiểm tra xác thực người dùng
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: "Bạn chưa đăng nhập hoặc token không hợp lệ.",
      });
    }

    // 2️⃣ Lấy danh sách hoá đơn của người dùng
    const invoices = await Invoice.find({ assignedTo: req.user._id, collectionStatus: "not_collected" })
      .populate("assignedTo", "fullName email") // Nếu muốn lấy thêm thông tin người được chỉ định
      .sort({ billing_period: -1 });

    // 3️⃣ Nếu không có hoá đơn nào
    if (!invoices || invoices.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy hoá đơn nào được giao cho bạn.",
      });
    }

    // 4️⃣ Trả về dữ liệu
    res.status(200).json(invoices);
  } catch (error) {
    console.error("Lỗi khi lấy hoá đơn:", error);
    res.status(500).json({
      success: false,
      message: "Đã có lỗi xảy ra khi lấy dữ liệu hoá đơn.",
      error: (error as Error).message,
    });
  }
};

export const fetchAllColInvoiceByUser = async (req: Request, res: Response) => {
  try {
    // 1️⃣ Kiểm tra xác thực người dùng
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: "Bạn chưa đăng nhập hoặc token không hợp lệ.",
      });
    }

    // 2️⃣ Lấy danh sách hoá đơn của người dùng
    const invoices = await Invoice.find({ assignedTo: req.user._id, collectionStatus: "collected" })
      .populate("assignedTo", "fullName email") // Nếu muốn lấy thêm thông tin người được chỉ định
      .sort({ billing_period: -1 });

    // 3️⃣ Nếu không có hoá đơn nào
    if (!invoices || invoices.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy hoá đơn nào được giao cho bạn.",
      });
    }

    // 4️⃣ Trả về dữ liệu
    res.status(200).json(invoices);
  } catch (error) {
    console.error("Lỗi khi lấy hoá đơn:", error);
    res.status(500).json({
      success: false,
      message: "Đã có lỗi xảy ra khi lấy dữ liệu hoá đơn.",
      error: (error as Error).message,
    });
  }
};

export const fetchUncollectedInvoicesByUser = async (req: Request, res: Response) => {
  const { customerCode } = req.query;

  try {
    // 1️⃣ Kiểm tra xác thực người dùng
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: "Bạn chưa đăng nhập hoặc token không hợp lệ.",
      });
    }

    // 2️⃣ Lấy danh sách hoá đơn của người dùng
    const invoices = await Invoice.findOne({
      assignedTo: req.user._id,
      invoiceNumber: customerCode,
      collectionStatus: "not_collected",
    }).populate("assignedTo", "fullName email"); // Nếu muốn lấy thêm thông tin người được chỉ định

    // 3️⃣ Nếu không có hoá đơn nào
    if (!invoices) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy hoá đơn nào được giao cho bạn.",
      });
    }

    // 4️⃣ Trả về dữ liệu
    res.status(200).json(invoices);
  } catch (error) {
    console.error("Lỗi khi lấy hoá đơn:", error);
    res.status(500).json({
      success: false,
      message: "Đã có lỗi xảy ra khi lấy dữ liệu hoá đơn.",
      error: (error as Error).message,
    });
  }
};

export const fetchCollectedInvoicesByUser = async (req: Request, res: Response) => {
  const { customerCode } = req.query;

  try {
    // 1️⃣ Kiểm tra xác thực người dùng
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: "Bạn chưa đăng nhập hoặc token không hợp lệ.",
      });
    }

    // 2️⃣ Lấy danh sách hoá đơn của người dùng
    const invoices = await Invoice.findOne({
      assignedTo: req.user._id,
      invoiceNumber: customerCode,
      collectionStatus: "collected",
    }).populate("assignedTo", "fullName email"); // Nếu muốn lấy thêm thông tin người được chỉ định

    // 3️⃣ Nếu không có hoá đơn nào
    if (!invoices) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy hoá đơn nào được giao cho bạn.",
      });
    }

    // 4️⃣ Trả về dữ liệu
    res.status(200).json(invoices);
  } catch (error) {
    console.error("Lỗi khi lấy hoá đơn:", error);
    res.status(500).json({
      success: false,
      message: "Đã có lỗi xảy ra khi lấy dữ liệu hoá đơn.",
      error: (error as Error).message,
    });
  }
};

export const exportInvoicesToExcel = async (req: Request, res: Response) => {
  try {
    // 1️⃣ Lấy tất cả dữ liệu hóa đơn
    const invoices: IInvoice[] = await Invoice.find({}).populate("assignedTo", "fullName email").lean();

    if (!invoices.length) {
      return res.status(404).json({ message: "Không có dữ liệu hóa đơn để xuất." });
    }

    // 2️⃣ Chuẩn bị dữ liệu xuất ra Excel — giống cấu trúc bên exportInvoicesToExcelPrinted
    const dataForExcel = invoices.map((invoice, index) => ({
      STT: index + 1,
      "Mã Khách Hàng": invoice.invoiceNumber || "",
      "Tên Khách Hàng": invoice.customerName || "",
      "Địa Chỉ": invoice.customerAddress || "",
      "Kỳ này": invoice.currentAmount ?? "",
      "Kỳ trước": invoice.previousAmount ?? "",
      "Tổng Tiền nợ": invoice.totalAmount ?? "",
      "Số điện thoại": invoice.customerPhone || "",
      "Ghi chú": invoice.note || "",
      "Nhân viên phụ trách":
        typeof invoice.assignedTo === "object" && "fullName" in invoice.assignedTo!
          ? (invoice.assignedTo as IUser).fullName
          : "",
      "Trạng Thái In": invoice.printStatus || "",
      "Trạng Thái Thu": invoice.collectionStatus || "",
      "Ngày Thu": invoice.collectionDate ? new Date(invoice.collectionDate).toLocaleDateString("vi-VN") : "",
      "Tháng nợ": invoice.billing_period || "",
    }));

    // 3️⃣ Tạo workbook + worksheet
    const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Danh Sách Hóa Đơn");

    // 4️⃣ Cấu hình độ rộng cột — đồng bộ với hàm Printed
    worksheet["!cols"] = [
      { wch: 5 }, // STT
      { wch: 17 }, // Mã KH
      { wch: 35 }, // Tên KH
      { wch: 35 }, // Địa chỉ
      { wch: 15 }, // Kỳ này
      { wch: 15 }, // Kỳ trước
      { wch: 20 }, // Tổng tiền nợ
      { wch: 20 }, // SĐT
      { wch: 25 }, // Ghi chú
      { wch: 25 }, // Nhân viên
      { wch: 15 }, // Trạng thái in
      { wch: 15 }, // Trạng thái thu
      { wch: 15 }, // Ngày thu
      { wch: 15 }, // Tháng nợ
    ];

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

export const exportInvoicesToExcelPrinted = async (req: Request, res: Response) => {
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
      .populate("assignedTo", "fullName email")
      .lean();

    if (!invoices.length) {
      return res.status(404).json({ message: "Không có dữ liệu hóa đơn để xuất." });
    }

    // ✅ Chuẩn bị dữ liệu xuất ra Excel
    const dataForExcel = invoices.map((invoice, index) => ({
      STT: index + 1,
      "Mã Khách Hàng": invoice.invoiceNumber || "",
      "Tên Khách Hàng": invoice.customerName || "",
      "Địa Chỉ": invoice.customerAddress || "",
      "Kỳ này": invoice.currentAmount ?? "",
      "Kỳ trước": invoice.previousAmount ?? "",
      "Tổng Tiền nợ": invoice.totalAmount ?? "",
      "Số điện thoại": invoice.customerPhone || "",
      "Ghi chú": invoice.note || "",
      "Nhân viên phụ trách":
        typeof invoice.assignedTo === "object" && "fullName" in invoice.assignedTo!
          ? (invoice.assignedTo as IUser).fullName
          : "",
      "Trạng Thái In": invoice.printStatus || "",
      "Trạng Thái Thu": invoice.collectionStatus || "",
      "Ngày Thu": invoice.collectionDate ? new Date(invoice.collectionDate).toLocaleDateString("vi-VN") : "",
      "Tháng nợ": invoice.billing_period || "",
    }));

    // ✅ Tạo workbook + worksheet
    const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Danh Sách Hóa Đơn");

    // ✅ Cấu hình độ rộng cột
    worksheet["!cols"] = [
      { wch: 5 }, // STT
      { wch: 17 }, // Mã KH
      { wch: 35 }, // Tên KH
      { wch: 35 }, // Địa chỉ
      { wch: 15 }, // Kỳ này
      { wch: 15 }, // Kỳ trước
      { wch: 20 }, // Tổng tiền nợ
      { wch: 20 }, // SĐT
      { wch: 25 }, // Ghi chú
      { wch: 25 }, // Nhân viên
      { wch: 15 }, // Trạng thái in
      { wch: 15 }, // Trạng thái thu
      { wch: 15 }, // Ngày thu
      { wch: 15 }, // Tháng nợ
    ];

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

export const toggleInvoiceStatus = async (req: Request, res: Response) => {
  try {
    const invoiceId = req.params.invoiceId;
    const { field } = req.body; // "printStatus" | "collectionStatus"

    console.log(invoiceId, field);

    if (!["printStatus", "collectionStatus"].includes(field)) {
      return res.status(400).json({ message: "Field không hợp lệ" });
    }

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return res.status(404).json({ message: "Hóa đơn không tồn tại" });

    // Toggle trạng thái
    if (field === "printStatus") {
      invoice.printStatus = invoice.printStatus === "printed" ? "not_printed" : "printed";
    } else if (field === "collectionStatus") {
      if (invoice.collectionStatus === "collected") {
        // Nếu đang là "đã thu" -> chuyển thành "chưa thu"
        invoice.collectionStatus = "not_collected";
        invoice.collectionDate = null; // Xóa ngày thu
      } else {
        // Nếu đang là "chưa thu" -> chuyển thành "đã thu"
        invoice.collectionStatus = "collected";
        invoice.collectionDate = new Date(); // Ghi ngày thu hiện tại
      }
    }

    await invoice.save();

    res.status(200).json(invoice);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Lỗi server" });
  }
};

export const createInvoice = async (req: Request, res: Response) => {
  try {
    // ✅ Lấy dữ liệu từ body
    const {
      invoiceNumber,
      customerName,
      customerPhone,
      customerAddress,
      billing_period,
      currentAmount,
      previousAmount,
      assignedTo,
    } = req.body.newInvoice;

    console.log(
      invoiceNumber,
      customerName,
      customerPhone,
      customerAddress,
      billing_period,
      currentAmount,
      previousAmount,
      assignedTo
    );

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

    // ✅ Tạo bản ghi mới
    const newInvoice = new Invoice({
      invoiceNumber,
      customerName,
      customerPhone,
      customerAddress,
      billing_period,
      currentAmount,
      previousAmount,
      totalAmount: Number(currentAmount) + Number(previousAmount), // ✅ tính tổng
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
    } = req.body.formData;
    const { invoiceNumber } = req.params;

    // console.log(
    //   customerName,
    //   customerAddress,
    //   customerPhone,
    //   currentAmount,
    //   previousAmount,
    //   totalAmount,
    //   note,
    //   assignedTo
    // );

    if (!invoiceNumber || !customerName || !currentAmount || !previousAmount || !totalAmount) {
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
    invoice.currentAmount = currentAmount;
    invoice.previousAmount = previousAmount;
    invoice.totalAmount = String(Number(currentAmount) + Number(previousAmount));
    invoice.assignedTo = finalAssignedTo;
    invoice.note = note !== undefined ? note : invoice.note;

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

    // console.log(invoiceNumber);

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
    const billing_period = `10/2025`;

    // Xoá toàn bộ hoá đơn theo kỳ thanh toán
    const result = await Invoice.deleteMany({ billing_period });

    console.log("Đã xoá thành công");
  } catch (error) {
    console.error("Lỗi khi xoá hoá đơn:", error);
  }
};
