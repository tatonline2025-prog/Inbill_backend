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

    // **Bước 1: Định nghĩa ánh xạ giữa tên cột Excel và trường trong database**
    // Quan trọng: Key ở đây PHẢI TRÙNG KHỚP với tên cột trong file Excel.
    const columnMapping = {
      "Mã khách hàng": "invoiceNumber",
      "Tên Khách Hàng": "customerName",
      "Tổng Tiền": "totalAmount",
      "Địa Chỉ": "customerAddress",
    };

    const fileBuffer = req.file.buffer;
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // **Bước 2: Chuyển sheet thành JSON object thay vì array của array**
    // Thư viện sẽ tự động dùng dòng đầu tiên làm key cho các object.
    const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

    // **Bước 3: Xử lý dữ liệu với tên cột đã được ánh xạ**
    const documentsToCreate = jsonData
      .map((row) => {
        const newDoc: any = {
          billing_period: billing_period,
          assignedTo: userId,
        };

        // Dùng vòng lặp để gán giá trị từ row vào newDoc dựa trên `columnMapping`
        for (const excelHeader in columnMapping) {
          if (row[excelHeader] !== undefined) {
            const dbField = columnMapping[excelHeader as keyof typeof columnMapping];
            newDoc[dbField] = row[excelHeader];
          }
        }

        // Chỉ xử lý những dòng có invoiceNumber
        if (!newDoc.invoiceNumber) {
          return null;
        }

        return newDoc;
      })
      .filter(Boolean); // Lọc ra những dòng null (không hợp lệ)

    if (documentsToCreate.length === 0) {
      return res.status(400).json({
        message: `Không tìm thấy dữ liệu hợp lệ trong file Excel. Vui lòng kiểm tra lại tên các cột. 
        Lưu ý các cột đầu tiên phải đúng tên sau: Mã khách hàng, Tên Khách Hàng, Tổng Tiền, Địa Chỉ `,
      });
    }

    // Dùng bulkWrite để update nếu đã có, insert nếu chưa có
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
  const result = await Invoice.find()
    .populate("assignedTo", "fullName email") // Nếu muốn lấy thêm thông tin người được chỉ định
    .sort({ billing_period: -1 });

  res.status(200).json(result);
};

export const fetchInvoiceByUser = async (req: Request, res: Response) => {
  try {
    // 1️⃣ Kiểm tra xác thực người dùng
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Bạn chưa đăng nhập hoặc token không hợp lệ.",
      });
    }

    // 2️⃣ Lấy danh sách hoá đơn của người dùng
    const invoices = await Invoice.find({ assignedTo: req.user.id })
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

export const fetchAllUnColInvoiceByUser = async (req: Request, res: Response) => {
  try {
    // 1️⃣ Kiểm tra xác thực người dùng
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Bạn chưa đăng nhập hoặc token không hợp lệ.",
      });
    }

    // 2️⃣ Lấy danh sách hoá đơn của người dùng
    const invoices = await Invoice.find({ assignedTo: req.user.id, collectionStatus: "not_collected" })
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
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Bạn chưa đăng nhập hoặc token không hợp lệ.",
      });
    }

    // 2️⃣ Lấy danh sách hoá đơn của người dùng
    const invoices = await Invoice.find({ assignedTo: req.user.id, collectionStatus: "collected" })
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
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Bạn chưa đăng nhập hoặc token không hợp lệ.",
      });
    }

    // 2️⃣ Lấy danh sách hoá đơn của người dùng
    const invoices = await Invoice.findOne({
      assignedTo: req.user.id,
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
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Bạn chưa đăng nhập hoặc token không hợp lệ.",
      });
    }

    // 2️⃣ Lấy danh sách hoá đơn của người dùng
    const invoices = await Invoice.findOne({
      assignedTo: req.user.id,
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
    // 1. Lấy tất cả dữ liệu hóa đơn từ database
    // Dùng lean() để lấy object thuần túy, nhanh hơn
    const invoices: IInvoice[] = await Invoice.find({}).populate("assignedTo", "fullName email").lean();

    if (invoices.length === 0) {
      return res.status(404).json({ message: "Không có dữ liệu hóa đơn để xuất." });
    }

    // 2. Chuẩn bị dữ liệu với tiêu đề tiếng Việt
    const dataForExcel = invoices.map((invoice, index) => ({
      STT: index + 1,
      "Mã Khách Hàng": invoice.invoiceNumber,
      "Tên Khách Hàng": invoice.customerName,
      "Số điện thoại": invoice.customerPhone,
      "Địa Chỉ": invoice.customerAddress,
      "Kỳ Thanh Toán": invoice.billing_period,
      "Tổng Tiền": invoice.totalAmount,
      "Nhân viên phụ trách":
        typeof invoice.assignedTo === "object" && "fullName" in invoice.assignedTo!
          ? (invoice.assignedTo as IUser).fullName
          : "",

      "Trạng Thái Thu Hộ": invoice.collectionStatus,
      "Trạng Thái In": invoice.printStatus,
      "Ngày Thu": invoice.collectionDate ? new Date(invoice.collectionDate).toLocaleDateString("vi-VN") : "",
    }));

    // 3. Tạo một workbook và worksheet mới từ dữ liệu JSON
    const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Danh Sách Hóa Đơn");

    // Tùy chỉnh độ rộng cột (tùy chọn)
    worksheet["!cols"] = [
      { wch: 10 },
      { wch: 20 },
      { wch: 25 },
      { wch: 15 },
      { wch: 35 },
      { wch: 15 },
      { wch: 20 },
      { wch: 25 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
    ];

    // 4. Ghi workbook vào một buffer (dữ liệu nhị phân)
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });

    // 5. Thiết lập HTTP Headers để trình duyệt hiểu đây là một file cần tải về
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="danh-sach-hoa-don-${Date.now()}.xlsx"`);

    // 6. Gửi buffer về cho client
    res.send(buffer);
  } catch (error) {
    console.error("Lỗi khi xuất file Excel:", error);
    res.status(500).json({ message: "Đã có lỗi xảy ra trên máy chủ." });
  }
};

export const exportInvoicesToExcelPrinted = async (req: Request, res: Response) => {
  const dateParam = req.query.date as string | undefined;

  const startOfDay = new Date(dateParam!);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(dateParam!);
  endOfDay.setHours(23, 59, 59, 999);

  try {
    // 1. Lấy tất cả dữ liệu hóa đơn từ database
    // Dùng lean() để lấy object thuần túy, nhanh hơn
    const invoices: IInvoice[] = await Invoice.find({
      collectionStatus: "collected",
      collectionDate: { $gte: startOfDay, $lte: endOfDay },
    })
      .populate("assignedTo", "fullName email")
      .lean();
    if (invoices.length === 0) {
      return res.status(404).json({ message: "Không có dữ liệu hóa đơn để xuất." });
    }
    // 2. Chuẩn bị dữ liệu với tiêu đề tiếng Việt
    const dataForExcel = invoices.map((invoice, index) => ({
      STT: index + 1,
      "Số Hóa Đơn": invoice.invoiceNumber,
      "Tên Khách Hàng": invoice.customerName,
      "Số điện thoại": invoice.customerPhone,
      "Địa Chỉ": invoice.customerAddress,
      "Kỳ Thanh Toán": invoice.billing_period,
      "Tổng Tiền": invoice.totalAmount,
      "Nhân viên phụ trách":
        typeof invoice.assignedTo === "object" && "fullName" in invoice.assignedTo!
          ? (invoice.assignedTo as IUser).fullName
          : "",

      "Trạng Thái Thu Hộ": invoice.collectionStatus,
      "Trạng Thái In": invoice.printStatus,
      "Ngày Thu": invoice.collectionDate ? new Date(invoice.collectionDate).toLocaleDateString("vi-VN") : "",
    }));
    // 3. Tạo một workbook và worksheet mới từ dữ liệu JSON
    const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Danh Sách Hóa Đơn");
    // Tùy chỉnh độ rộng cột (tùy chọn)
    worksheet["!cols"] = [
      { wch: 10 },
      { wch: 20 },
      { wch: 25 },
      { wch: 15 },
      { wch: 35 },
      { wch: 15 },
      { wch: 20 },
      { wch: 25 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
    ];
    // 4. Ghi workbook vào một buffer (dữ liệu nhị phân)
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    // 5. Thiết lập HTTP Headers để trình duyệt hiểu đây là một file cần tải về
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="danh-sach-hoa-don-${Date.now()}.xlsx"`);
    // 6. Gửi buffer về cho client
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

    // console.log(invoiceId, field);

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
