import { Request, Response } from "express";
import TransactionType from "../models/transactionTypeModel";
import Bank from "../models/bankModel";
import Transaction from "../models/transactionModel";
import User from "../models/userModel";
import mongoose, { Types } from "mongoose";
import { generateTransactionExcel } from "../utils/generateTransactionExcel";

/**
 * @desc    Admin tạo một Loại Giao dịch (TransactionType) mới
 * @route   POST /api/admin/config/types
 * @access  Private/Admin
 */
export const createTransactionType = async (req: Request, res: Response) => {
  const { name, description } = req.body;
  if (!req.user) {
    return res.status(400).json({ message: "Không xác thực được người dùng" });
  }

  if (req.user.role !== "admin") {
    return res.status(400).json({ message: "Tài khoản không có quyền thực hiện thao tác này" });
  }

  const adminId = req.user._id;

  try {
    const existingType = await TransactionType.findOne({ name });

    if (existingType) {
      return res.status(409).json({ message: "Tên loại giao dịch này đã tồn tại." });
    }

    const newTransactionType = new TransactionType({
      name,
      description: description || "",
      createdBy: adminId,
    });

    const createdType = await newTransactionType.save();

    res.status(201).json({
      message: "Tạo loại giao dịch thành công!",
      type: createdType,
    });
  } catch (error) {
    console.error("Lỗi khi tạo loại giao dịch:", error);
    res.status(500).json({ message: "Lỗi server nội bộ." });
  }
};

export const deleteTransactionType = async (req: Request, res: Response) => {
  const { transactionTypeId } = req.body;
  if (!req.user) {
    return res.status(401).json({ message: "Không xác thực được người dùng" }); // Dùng 401 cho lỗi xác thực
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Tài khoản không có quyền thực hiện thao tác này" }); // Dùng 403 cho lỗi cấm/không có quyền
  }

  if (!transactionTypeId) {
    return res.status(400).json({ message: "Thiếu ID loại giao dịch để xóa." });
  }

  try {
    const deletedType = await TransactionType.findByIdAndDelete(transactionTypeId);

    if (!deletedType) {
      return res.status(404).json({ message: "Không tìm thấy loại giao dịch để xóa." });
    }

    res.status(200).json({
      message: "Xóa loại giao dịch thành công!",
      type: deletedType,
    });
  } catch (error) {
    console.error("Lỗi khi xóa loại giao dịch:", error);
    res.status(500).json({ message: "Lỗi server nội bộ." });
  }
};

export const updateTransactionType = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(400).json({ message: "Không xác thực được người dùng" });
  }

  if (req.user.role !== "admin") {
    return res.status(400).json({ message: "Tài khoản không có quyền thực hiện thao tác này" });
  }

  const { transactionTypeId, name, description } = req.body;

  try {
    const existingType = await TransactionType.findOne({
      name,
      _id: { $ne: transactionTypeId }, // Loại trừ chính ID đang cập nhật
    });

    if (existingType) {
      return res.status(409).json({ message: "Tên loại giao dịch này đã tồn tại." });
    }

    const updatedType = await TransactionType.findByIdAndUpdate(
      transactionTypeId,
      {
        name,
        description: description || "",
        updatedAt: new Date(),
        createdBy: req.user._id,
      },
      { new: true, runValidators: true } // Trả về đối tượng mới và chạy validation
    );

    if (!updatedType) {
      return res.status(404).json({ message: "Không tìm thấy loại giao dịch cần cập nhật." });
    }

    res.status(200).json({
      message: "Cập nhật loại giao dịch thành công!",
      type: updatedType,
    });
  } catch (error) {
    console.error("Lỗi khi cập nhật loại giao dịch:", error);
    res.status(500).json({ message: "Lỗi server nội bộ." });
  }
};

export const getTransactionTypes = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(400).json({ message: "Không xác thực được người dùng" });
  }

  try {
    const types = await TransactionType.find({}).select("_id name description").sort({ name: 1 });

    if (types.length === 0) {
      return res.status(200).json({
        message: "Chưa có loại giao dịch nào được tạo.",
        types: [],
      });
    }

    res.status(200).json({
      message: "Lấy danh sách loại giao dịch thành công!",
      types,
    });
  } catch (error) {
    console.error("Lỗi khi lấy danh sách loại giao dịch:", error);
    res.status(500).json({ message: "Lỗi server nội bộ." });
  }
};

export const createBank = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(400).json({ message: "Không xác thực được người dùng" });
  }

  if (req.user.role !== "admin") {
    return res.status(400).json({ message: "Tài khoản không có quyền thực hiện thao tác này" });
  }

  // Lấy tên ngân hàng và loại bỏ khoảng trắng thừa ở đầu/cuối
  const rawBankName = req.body.formData.bankName.trim();
  const adminId = req.user._id;

  try {
    // --- KHÚC QUAN TRỌNG NHẤT ---
    // Sử dụng $regex để tìm kiếm không phân biệt hoa thường.
    // ^ và $ để đảm bảo trùng khớp hoàn toàn (tránh trường hợp "Vietcom" tìm ra "Vietcombank")
    // 'i' là option case-insensitive
    const existingBank = await Bank.findOne({
      bankName: { $regex: new RegExp(`^${rawBankName}$`, "i") },
    });

    if (existingBank) {
      // Nếu tìm thấy (dù là VietcomBank, VIETCOMBANK...) thì báo lỗi
      return res.status(409).json({ message: "Hình thức thanh toán này đã được thêm vào hệ thống." });
    }

    // Nếu chưa có thì mới tạo mới và lưu dưới dạng chữ thường (như bạn muốn)
    const newBank = new Bank({
      bankName: rawBankName,
      createdBy: adminId,
    });

    const createdBank = await newBank.save();

    res.status(201).json({
      message: "Thêm thông tin ngân hàng thành công!",
      bank: createdBank,
    });
  } catch (error) {
    console.error("Lỗi khi thêm thông tin ngân hàng:", error);
    res.status(500).json({ message: "Lỗi server nội bộ." });
  }
};

export const updateBank = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: "Không xác thực được người dùng" });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Tài khoản không có quyền thực hiện thao tác này" });
  }

  const { bankId } = req.body;
  const rawBankName = req.body.formData.bankName ? req.body.formData.bankName.trim() : "";

  if (!rawBankName) {
    return res.status(400).json({ message: "Tên ngân hàng là bắt buộc." });
  }

  try {
    // --- LOGIC KIỂM TRA TRÙNG LẶP ---
    // 1. Dùng Regex để so sánh không phân biệt hoa thường
    // 2. Dùng $ne (not equal) để loại trừ chính bản ghi đang sửa (bankId)
    const existingBank = await Bank.findOne({
      bankName: { $regex: new RegExp(`^${rawBankName}$`, "i") }, // So sánh: VietcomBank == vietcombank
      _id: { $ne: bankId }, // Không check chính nó
    });

    if (existingBank) {
      return res.status(400).json({ message: "Tên hình thức thanh toán này đã được đăng ký." });
    }

    // --- CẬP NHẬT ---
    const updatedBank = await Bank.findByIdAndUpdate(
      bankId,
      {
        // Lưu dưới dạng chữ thường để đồng bộ với createBank (hoặc rawBankName tuỳ bạn chọn)
        bankName: rawBankName,
        updatedAt: new Date(),
      },
      { new: true, runValidators: true }
    );

    if (!updatedBank) {
      return res.status(404).json({ message: "Không tìm thấy thông tin ngân hàng cần cập nhật." });
    }

    res.status(200).json({
      message: "Cập nhật thông tin ngân hàng thành công!",
      bank: updatedBank,
    });
  } catch (error) {
    console.error("Lỗi khi cập nhật thông tin ngân hàng:", error);
    res.status(500).json({ message: "Lỗi server nội bộ." });
  }
};

export const getBanks = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(400).json({ message: "Không xác thực được người dùng" });
  }

  if (req.user.role !== "admin") {
    return res.status(400).json({ message: "Tài khoản không có quyền thực hiện thao tác này" });
  }

  try {
    const banks = await Bank.find({}).select("bankName");

    if (banks.length === 0) {
      return res.status(200).json({
        message: "Chưa có tài khoản ngân hàng nào được thêm vào.",
        banks: [],
      });
    }

    res.status(200).json({
      message: "Lấy danh sách tài khoản ngân hàng thành công!",
      banks,
    });
  } catch (error) {
    console.error("Lỗi khi thêm thông tin ngân hàng:", error);
    res.status(500).json({ message: "Lỗi server nội bộ." });
  }
};

export const getAllTransactionsForAdmin = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(400).json({ message: "Không xác thực được người dùng" });
  }
  if (req.user.role !== "admin") {
    return res.status(400).json({ message: "..." });
  }

  try {
    const { searchName, startDate, endDate, status } = req.query;
    let filter: any = {};
    let userFilter = {};

    if (searchName) {
      const users = await User.find({
        fullName: { $regex: searchName, $options: "i" },
        // Chỉ tìm CTV
        role: "user",
        usertype: "collaborator",
      }).select("_id");

      const userIds = users.map((user) => user._id);

      // Nếu không tìm thấy CTV nào, trả về mảng rỗng
      if (userIds.length === 0) {
        return res.status(200).json({
          message: "Không tìm thấy giao dịch nào phù hợp với tên CTV.",
          transactions: [],
        });
      }
      filter.creatorId = { $in: userIds };
    }

    // 2. Lọc theo Ngày giờ tạo (startDate, endDate)
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        // Ngày bắt đầu (từ 00:00:00 của ngày đó)
        filter.createdAt.$gte = new Date(startDate as string);
      }
      if (endDate) {
        // Ngày kết thúc (đến 23:59:59 của ngày đó)
        const nextDay = new Date(endDate as string);
        nextDay.setDate(nextDay.getDate() + 1);
        filter.createdAt.$lt = nextDay;
      }
    }

    // 3. Lọc theo Trạng thái (status)
    if (status && ["PENDING", "APPROVED", "CANCELLED"].includes((status as string).toUpperCase())) {
      filter.status = (status as string).toUpperCase();
    }

    // 4. Lấy dữ liệu và Populate các khóa ngoại
    const transactions = await Transaction.find(filter)
      .populate("creatorId", "fullName username bankAccount bankName") // Lấy tên CTV
      .populate("paymentSourceId", "bankName") // Lấy tên Loại GD
      .populate("typeId", "name") // Lấy tên Loại GD
      .sort({ createdAt: -1 });

    res.status(200).json({
      message: "Lấy danh sách giao dịch thành công.",
      total: transactions.length,
      transactions,
    });
  } catch (error) {
    console.error("Lỗi khi Admin lấy giao dịch:", error);
    res.status(500).json({ message: "Lỗi server nội bộ." });
  }
};

export const approveTransaction = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(400).json({ message: "Không xác thực được người dùng" });
  }

  if (req.user.role !== "admin") {
    return res.status(400).json({ message: "Tài khoản không có quyền thực hiện thao tác này" });
  }

  const transactionId = req.params.id;
  const adminId = req.user?._id;
  const { paymentBankId } = req.body;

  try {
    const transaction = await Transaction.findById(transactionId);

    if (!transaction) {
      return res.status(404).json({ message: "Không tìm thấy giao dịch." });
    }

    if (transaction.status !== "PENDING") {
      return res.status(403).json({
        message: `Giao dịch đã ở trạng thái ${transaction.status}. Không thể duyệt lại.`,
      });
    }

    transaction.status = "APPROVED";
    transaction.approvedByAdminId = new Types.ObjectId(adminId);
    transaction.paymentSourceId = new Types.ObjectId(paymentBankId);

    const approvedTransaction = await transaction.save();

    res.status(200).json({
      message: "Xét duyệt giao dịch thành công! Trạng thái đã chuyển sang APPROVED.",
      transaction: approvedTransaction,
    });
  } catch (error) {
    console.error("Lỗi khi Admin duyệt giao dịch:", error);
    res.status(500).json({ message: "Lỗi server nội bộ." });
  }
};

export const cancelTransaction = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(400).json({ message: "Không xác thực được người dùng" });
  }

  if (req.user.role !== "admin") {
    return res.status(400).json({ message: "Tài khoản không có quyền thực hiện thao tác này" });
  }

  const transactionId = req.params.id;
  const adminId = req.user?._id;

  try {
    const transaction = await Transaction.findById(transactionId);

    if (!transaction) {
      return res.status(404).json({ message: "Không tìm thấy giao dịch." });
    }

    // 1. Kiểm tra nếu giao dịch đã bị Hủy trước đó
    if (transaction.status === "CANCELLED") {
      return res.status(403).json({
        message: "Giao dịch này đã bị hủy rồi.",
      });
    }

    // 2. Cập nhật trạng thái
    transaction.status = "CANCELLED";
    transaction.approvedByAdminId = new Types.ObjectId(adminId); // Ghi nhận Admin đã thực hiện hủy

    const cancelledTransaction = await transaction.save();

    res.status(200).json({
      message: "Hủy giao dịch thành công!",
      transaction: cancelledTransaction,
    });
  } catch (error) {
    console.error("Lỗi khi Admin hủy giao dịch:", error);
    res.status(500).json({ message: "Lỗi server nội bộ." });
  }
};

export const getDailyReport = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(400).json({ message: "Không xác thực được người dùng" });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Bạn không có quyền xem báo cáo." });
  }

  const { startDate, endDate } = req.query;

  // 1. Xây dựng điều kiện lọc ngày
  let matchCondition: any = {};

  // Mặc định: Nếu không chọn ngày, lọc tất cả.
  // Nếu có startDate/endDate, query theo range.
  if (startDate || endDate) {
    matchCondition.createdAt = {};
    if (startDate) {
      matchCondition.createdAt.$gte = new Date(startDate as string);
    }
    if (endDate) {
      const nextDay = new Date(endDate as string);
      nextDay.setDate(nextDay.getDate() + 1); // Cộng thêm 1 ngày để lấy hết ngày endDate
      matchCondition.createdAt.$lt = nextDay;
    }
  }

  try {
    const dailyReport = await Transaction.aggregate([
      { $match: matchCondition },

      {
        $lookup: {
          from: "transactiontypes",
          localField: "typeId",
          foreignField: "_id",
          as: "typeInfo",
        },
      },
      // Làm phẳng mảng typeInfo (biến mảng 1 phần tử thành object)
      { $unwind: { path: "$typeInfo", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "users",
          localField: "creatorId",
          foreignField: "_id",
          as: "creatorInfo",
        },
      },
      // Làm phẳng mảng creatorInfo
      { $unwind: { path: "$creatorInfo", preserveNullAndEmptyArrays: true } },

      { $sort: { createdAt: -1 } },

      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
              timezone: "+07:00", // QUAN TRỌNG: Chuyển về giờ Việt Nam để cắt ngày đúng
            },
          },
          totalTransactions: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          totalFinalAmount: { $sum: "$finalAmount" },

          transactions: {
            $push: {
              _id: "$_id",
              transactionType: "$typeInfo.name", // Lấy trực tiếp do đã unwind
              creatorName: "$creatorInfo.fullName", // Lấy trực tiếp do đã unwind

              creatorBankName: "$creatorInfo.bankName",
              creatorBankAccount: "$creatorInfo.bankAccount",

              discountPercent: "$discountPercent",

              amount: "$amount",
              finalAmount: "$finalAmount",
              status: "$status",
              createdAt: "$createdAt",
              note: "$note",
            },
          },
        },
      },

      { $sort: { _id: -1 } },

      {
        $project: {
          _id: 0,
          date: "$_id",
          totalTransactions: 1,
          totalAmount: { $round: ["$totalAmount", 0] },
          totalFinalAmount: { $round: ["$totalFinalAmount", 0] },
          transactions: 1,
        },
      },
    ]);

    res.status(200).json({
      message: "Lấy báo cáo tổng hợp theo ngày thành công.",
      report: dailyReport,
    });
  } catch (error) {
    console.error("Lỗi khi lấy báo cáo Daily:", error);
    res.status(500).json({ message: "Lỗi server nội bộ." });
  }
};

// export const updateTransactionByAdmin = async (req: Request, res: Response) => {
//   const transactionId = req.params.id;
//   // Chỉ nhận các trường mà Admin được phép sửa đổi
//   const { amount, discountPercent, typeId, status, paymentBankId } = req.body;

//   try {
//     const transaction = await Transaction.findById(transactionId);

//     if (!transaction) {
//       return res.status(404).json({ message: "Không tìm thấy giao dịch." });
//     }

//     // 1. QUY TẮC NGHIỆP VỤ: KHÔNG sửa nếu ĐÃ DUYỆT (APPROVED)
//     if (transaction.status === "APPROVED") {
//       return res.status(403).json({
//         message: "Không thể chỉnh sửa giao dịch đã được xét duyệt.",
//       });
//     }

//     // 2. Cập nhật thông tin (Chỉ cập nhật nếu giá trị được gửi lên)
//     if (amount !== undefined) transaction.amount = amount;
//     if (discountPercent !== undefined) transaction.discountPercent = discountPercent;

//     if (typeId !== undefined) {
//       const transactionType = await TransactionType.findById(typeId);
//       if (!transactionType) return res.status(400).json({ message: "Loại giao dịch không hợp lệ." });
//       transaction.typeId = typeId;
//     }

//     // Admin có thể thay đổi trạng thái TẠM THỜI (PENDING/CANCELLED)
//     if (status && (status === "PENDING" || status === "CANCELLED")) {
//       transaction.status = status;
//     }

//     // Admin có thể sửa Bank (trong trường hợp PENDING hoặc CANCELLED)
//     if (paymentBankId !== undefined) {
//       // Kiểm tra nếu giá trị không phải null, thì phải là ID Bank hợp lệ
//       if (paymentBankId) {
//         const bank = await Bank.findById(paymentBankId);
//         if (!bank) return res.status(400).json({ message: "Bank ID không hợp lệ." });
//       }
//       // Gán giá trị (có thể là null)
//       transaction.paymentBankId = paymentBankId;
//       // Cần xử lý lỗi Type 'string' is not assignable to type 'ObjectId' nếu không sửa Schema
//     }

//     // 3. TÍNH TOÁN LẠI finalAmount nếu amount hoặc discountPercent thay đổi
//     if (amount !== undefined || discountPercent !== undefined) {
//       const newFinalAmount = transaction.amount * (1 - transaction.discountPercent / 100);
//       transaction.finalAmount = newFinalAmount;
//     }

//     const updatedTransaction = await transaction.save();
//     res.status(200).json({
//       message: "Admin cập nhật giao dịch thành công!",
//       transaction: updatedTransaction,
//     });
//   } catch (error) {
//     console.error("Lỗi khi Admin cập nhật giao dịch:", error);
//     res.status(500).json({ message: "Lỗi server nội bộ." });
//   }
// };

export const deleteTransactionByAdmin = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(400).json({ message: "Không xác thực được người dùng" });
  }
  if (req.user.role !== "admin") {
    return res.status(400).json({ message: "..." });
  }

  const transactionId = req.params.id;

  try {
    const transaction = await Transaction.findById(transactionId);

    if (!transaction) {
      return res.status(404).json({ message: "Không tìm thấy giao dịch." });
    }

    // 1. QUY TẮC NGHIỆP VỤ: KHÔNG xóa nếu ĐÃ DUYỆT (APPROVED)
    if (transaction.status === "APPROVED") {
      return res.status(403).json({
        message: "Không thể xóa giao dịch đã được xét duyệt.",
      });
    }

    // 2. Thực hiện xóa
    // Sử dụng findByIdAndDelete để xóa theo ID và nhận lại đối tượng đã xóa
    const deletedTransaction = await Transaction.findByIdAndDelete(transactionId);

    if (!deletedTransaction) {
      return res.status(404).json({ message: "Giao dịch không tồn tại." });
    }

    res.status(200).json({
      message: "Admin xóa giao dịch thành công.",
      transactionId: transactionId,
    });
  } catch (error) {
    console.error("Lỗi khi Admin xóa giao dịch:", error);
    res.status(500).json({ message: "Lỗi server nội bộ." });
  }
};

export const exportAllTransactions = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(400).json({ message: "Không xác thực được người dùng" });
  }

  try {
    const { collaborator, date, type } = req.query;

    let filter: any = {};

    if (collaborator && typeof collaborator === "string") {
      filter.creatorId = collaborator;
    }

    if (type === "SPECIFIC_DATE" && date && typeof date === "string") {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      filter.createdAt = { $gte: startOfDay, $lte: endOfDay };
    }

    const transactions = await Transaction.find(filter)
      .populate("creatorId", "fullName bankName bankAccount")
      .populate("typeId", "name")
      .populate("paymentSourceId", "bankName")
      .sort({ createdAt: -1 })
      .lean();

    if (transactions.length === 0) {
      return res.status(200).json({
        success: false,
        message: "Không có dữ liệu giao dịch để xuất Excel.",
      });
    }

    const dataToExport = transactions.map((t: any, index: number) => ({
      STT: index + 1,
      "Tên CTV": t.creatorId?.fullName || "N/A",
      "Loại Giao Dịch": t.typeId?.name || "N/A",
      "Số Tiền Gốc": t.amount,
      "Chiết Khấu (%)": t.discountPercent,
      "Tổng Tiền (Sau CK)": t.finalAmount,
      "Ngân Hàng CTV": t.creatorId ? `${t.creatorId.bankName} - ${t.creatorId.bankAccount}` : "Tiền mặt / Khác",
      "Hình thức": t.paymentSourceId ? `${t.paymentSourceId.bankName}` : "Chưa được duyệt",
      "Trạng Thái": t.status === "APPROVED" ? "Đã duyệt" : t.status === "PENDING" ? "Chờ duyệt" : "Đã hủy",
      "Ngày Tạo": new Date(t.createdAt).toLocaleDateString("vi-VN"),
    }));

    // Tạo file Excel
    const excelBuffer = await generateTransactionExcel(dataToExport, "Báo Cáo Giao Dịch");

    // Trả file
    const fileName = `bao_cao_${type === "SPECIFIC_DATE" ? date : "toan_bo"}_${Date.now()}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    return res.send(excelBuffer); // CHỈ gửi 1 response tại đây
  } catch (error) {
    console.error("Lỗi khi Admin xuất Excel:", error);
    return res.status(500).json({ message: "Lỗi server nội bộ." });
  }
};

// Các hàm phía dưới là chức năng của các CTV
export const createTransaction = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(400).json({ message: "Không xác thực được người dùng" });
  }

  const { amount, discountPercent, typeId } = req.body;

  const creatorId = req.user._id;

  try {
    const transactionType = await TransactionType.findById(typeId);
    if (!transactionType) {
      return res.status(404).json({ message: "Loại giao dịch không hợp lệ." });
    }

    const finalAmount = amount * (1 - discountPercent / 100);

    if (finalAmount < 0) {
      return res.status(400).json({ message: "Số tiền sau chiết khấu không được âm." });
    }

    const newTransaction = new Transaction({
      amount,
      discountPercent,
      finalAmount: finalAmount.toFixed(2),
      typeId,
      creatorId,
      status: "PENDING",
      // approvedByAdminId sẽ là null mặc định
    });

    const createdTransaction = await newTransaction.save();

    res.status(201).json({
      message: "Tạo báo cáo giao dịch thành công! Vui lòng chờ Admin xét duyệt.",
      transaction: createdTransaction,
    });
  } catch (error) {
    console.error("Lỗi khi tạo giao dịch:", error);
    res.status(500).json({ message: "Lỗi server nội bộ." });
  }
};

export const getUserTransactions = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(400).json({ message: "Không xác thực được người dùng" });
  }

  const creatorId = req.user._id;

  try {
    // Tìm tất cả giao dịch có creatorId trùng với ID của User
    const transactions = await Transaction.find({ creatorId })
      .populate("typeId", "name")
      .populate("paymentSourceId", " bankName")
      .populate("creatorId", " bankName bankAccount")
      .sort({ createdAt: -1 }); // Sắp xếp GD mới nhất hiển thị ở trên

    res.status(200).json({
      message: "Lấy danh sách giao dịch thành công.",
      transactions,
    });
  } catch (error) {
    console.error("Lỗi khi lấy giao dịch:", error);
    res.status(500).json({ message: "Lỗi server nội bộ." });
  }
};

export const updateTransaction = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(400).json({ message: "Không xác thực được người dùng" });
  }

  const transactionId = req.params.id;
  const { amount, typeId, discountPercent } = req.body;
  const creatorId = req.user._id;

  try {
    const transaction = await Transaction.findById(transactionId);

    if (!transaction) {
      return res.status(404).json({ message: "Không tìm thấy giao dịch." });
    }

    if (transaction.creatorId.toString() !== creatorId.toString()) {
      return res.status(403).json({ message: "Bạn không có quyền chỉnh sửa giao dịch này." });
    }

    if (transaction.status !== "PENDING") {
      return res.status(403).json({
        message: `Chỉ có thể chỉnh sửa giao dịch ở trạng thái CHỜ DUYỆT. Trạng thái hiện tại: ${transaction.status}.`,
      });
    }

    // Cập nhật Amount
    if (amount !== undefined) {
      // Kiểm tra giá trị hợp lệ
      if (typeof amount !== "number" || amount < 0) {
        return res.status(400).json({ message: "Số tiền không hợp lệ." });
      }
      transaction.amount = amount;
    }

    // Cập nhật TypeId
    if (typeId !== undefined) {
      const transactionType = await TransactionType.findById(typeId);

      if (!transactionType) {
        return res.status(400).json({ message: "Loại giao dịch không hợp lệ." });
      }
      transaction.typeId = typeId;
    }

    if (discountPercent !== undefined) {
      // Kiểm tra giá trị hợp lệ (0% - 100%)
      if (typeof discountPercent !== "number" || discountPercent < 0 || discountPercent > 100) {
        return res.status(400).json({ message: "Chiết khấu phải là số từ 0 đến 100." });
      }
      transaction.discountPercent = discountPercent;
    }

    const newAmount = transaction.amount;
    const currentDiscount = transaction.discountPercent; // Lấy discountPercent mới/cũ từ transaction

    const newFinalAmount = newAmount * (1 - currentDiscount / 100);

    // Làm tròn 2 chữ số thập phân (nếu cần) và gán lại cho transaction
    transaction.finalAmount = Number(newFinalAmount.toFixed(2));

    // 6. Lưu và trả về
    const updatedTransaction = await transaction.save();
    res.status(200).json({
      message: "Cập nhật giao dịch thành công!",
      transaction: updatedTransaction,
    });
  } catch (error) {
    console.error("Lỗi khi cập nhật giao dịch:", error);
    res.status(500).json({ message: "Lỗi server nội bộ." });
  }
};

export const deleteTransaction = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(400).json({ message: "Không xác thực được người dùng" });
  }

  const transactionId = req.params.id;
  const creatorId = req.user._id;

  try {
    const transaction = await Transaction.findById(transactionId);

    if (!transaction) {
      return res.status(404).json({ message: "Không tìm thấy giao dịch." });
    }

    if (transaction.creatorId.toString() !== creatorId.toString()) {
      return res.status(403).json({ message: "Bạn không có quyền xóa giao dịch này." });
    }

    if (transaction.status !== "PENDING") {
      return res.status(403).json({
        message: `Chỉ có thể xóa giao dịch ở trạng thái CHỜ DUYỆT. Trạng thái hiện tại: ${transaction.status}.`,
      });
    }

    await Transaction.deleteOne({ _id: transactionId });

    res.status(200).json({
      message: "Xóa giao dịch thành công.",
    });
  } catch (error) {
    console.error("Lỗi khi xóa giao dịch:", error);
    res.status(500).json({ message: "Lỗi server nội bộ." });
  }
};

export const getAllCollaborators = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(400).json({ message: "Không xác thực được người dùng" });
  }
  if (req.user.role !== "admin") {
    return res.status(400).json({ message: "..." });
  }

  try {
    // Tìm tất cả user có role không phải là admin (hoặc là 'collaborator'/'user' tùy vào DB của bạn)
    // .select() dùng để chỉ lấy những trường cần thiết, tránh lộ password

    const collaborators = await User.find({ role: { $ne: "admin" }, usertype: "collaborator" })
      .select("_id fullName  phone") // Lấy ID, Tên,  Mã CTV, SĐT
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: collaborators.length,
      users: collaborators,
    });
  } catch (error) {
    console.error("Lỗi lấy danh sách CTV:", error);
    return res.status(500).json({
      success: false,
      message: "Lỗi server khi lấy danh sách cộng tác viên.",
    });
  }
};
