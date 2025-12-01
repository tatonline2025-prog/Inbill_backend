import { Request, Response } from "express";
import Invoice from "../models/invoiceModel";
import mongoose from "mongoose";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

// --- [ Public Queries - User ] ---

/**
 * Lấy tất cả hoá đơn được giao cho người dùng hiện tại.
 * GET /api/invoices/user
 */
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
      .populate("assignedTo", "fullName email phone collectionFee") // Nếu muốn lấy thêm thông tin người được chỉ định
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

/**
 * Lấy hoá đơn của người dùng theo kỳ hiện tại (tháng trước).
 * GET /api/invoices/user/current-month
 */
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
      .populate("assignedTo", "fullName email phone collectionFee") // Nếu muốn lấy thêm thông tin người được chỉ định
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

/**
 * Lấy tất cả hoá đơn CHƯA THU được giao cho người dùng hiện tại.
 * GET /api/invoices/user/uncollected
 */
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
      .populate("assignedTo", "fullName email phone collectionFee") // Nếu muốn lấy thêm thông tin người được chỉ định
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

export const fetchTop3StationsByUser = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: "Bạn chưa đăng nhập hoặc token không hợp lệ.",
      });
    }

    const { collectionStatus } = req.query;

    // Tạo đối tượng lọc cơ bản (áp dụng cho cả Admin và User thường)
    const matchQuery: any = {
      collectionStatus: collectionStatus || "not_collected",
      recordBookCode: { $nin: [null, "", undefined] },
    };

    // Kiểm tra quyền: Nếu KHÔNG PHẢI admin thì mới ép lọc theo assignedTo
    if (req.user.role !== "admin") {
      matchQuery.assignedTo = new mongoose.Types.ObjectId(req.user._id.toString());
    }

    // Thực hiện Aggregation
    const topStations = await Invoice.aggregate([
      {
        $match: matchQuery,
      },
      {
        $group: {
          _id: "$recordBookCode",
          totalAmount: { $sum: { $toDouble: "$totalAmount" } },
          count: { $sum: 1 },
        },
      },
      {
        $sort: {
          totalAmount: -1,
        },
      },
      {
        $limit: 3,
      },
      {
        $project: {
          _id: 0,
          stationName: "$_id",
          totalAmount: 1,
          count: 1,
        },
      },
    ]);

    if (!topStations || topStations.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    res.status(200).json({
      success: true,
      data: topStations,
    });
  } catch (error) {
    console.error("Lỗi khi thống kê top 3 trạm:", error);
    res.status(500).json({
      success: false,
      message: "Đã có lỗi xảy ra khi thống kê dữ liệu.",
      error: (error as Error).message,
    });
  }
};

/**
 * Lấy tất cả hoá đơn ĐÃ THU được giao cho người dùng hiện tại.
 * GET /api/invoices/user/collected
 */
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
      .populate("assignedTo", "fullName email phone collectionFee") // Nếu muốn lấy thêm thông tin người được chỉ định
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

/**
 * Tìm hoá đơn CHƯA THU của người dùng theo mã khách hàng.
 * GET /api/invoices/user/uncollected/search?customerCode=...
 */
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
    }).populate("assignedTo", "fullName email phone collectionFee"); // Nếu muốn lấy thêm thông tin người được chỉ định

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

/**
 * Tìm hoá đơn ĐÃ THU của người dùng theo mã khách hàng.
 * GET /api/invoices/user/collected/search?customerCode=...
 */
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
    }).populate("assignedTo", "fullName email phone collectionFee"); // Nếu muốn lấy thêm thông tin người được chỉ định

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

// --- [ Admin/Manager Queries - With Filters, Pagination ] ---

/**
 * Lấy danh sách hóa đơn với lọc, phân trang và tổng hợp (Aggregate).
 * GET /api/invoices/all
 */
export const fetchallInvoice = async (req: Request, res: Response) => {
  try {
    const {
      currentPage = "1",
      invoicesPerPage = "20",
      printStatus,
      collectionStatus,
      assignedUserId,
      province,
      customerCode,
      stationCode,
      userprovince,
      collectionDate,
      sortField,
      sortDirection,
      isPaid,
    } = req.query;

    const page = parseInt(currentPage as string, 10);
    const limit = parseInt(invoicesPerPage as string, 10);
    const skip = (page - 1) * limit;

    const isPaidBool = isPaid === "true";

    let assignedUser = assignedUserId;

    // ✅ Pipeline aggregate
    const match: any = {};

    if (req.user?.role === "admin") {
      // Kiểm tra: Nếu KHÔNG phải string HOẶC là string nhưng rỗng thì gán = "all"
      if (typeof assignedUser !== "string" || !assignedUser.trim()) {
        assignedUser = "all";
      }

      // Xử lý isPaid
      if (isPaidBool) {
        match.isPaid = true;
      } else {
        match.isPaid = { $ne: true };
      }
    } else {
      match.isPaid = { $ne: true };
    }
    if (printStatus && printStatus !== "all") {
      match.printStatus = printStatus === "not_printed" ? { $ne: "printed" } : "printed";
    }

    if (collectionStatus && collectionStatus !== "all") {
      match.collectionStatus = collectionStatus;
    }

    if (assignedUser && assignedUser !== "all" && assignedUser !== "no_one") {
      // Nếu truyền id cụ thể → chỉ lấy hóa đơn của người đó hoặc hóa đơn chưa giao
      match.$or = [
        // 1️⃣ Hóa đơn đã được giao cho chính người đó
        { assignedTo: new mongoose.Types.ObjectId(assignedUser as string) },

        // 2️⃣ Hóa đơn chưa giao + cùng tỉnh
        {
          $and: [
            {
              $or: [{ assignedTo: { $exists: false } }, { assignedTo: null }, { assignedTo: "" }],
            },
            { province: userprovince }, // thay bằng biến tỉnh của user
          ],
        },
      ];
    } else if (assignedUser === "no_one") {
      // ✅ Nếu chọn "no_one" → chỉ lấy hóa đơn chưa giao (bỏ điều kiện tỉnh nếu bạn không muốn lọc theo tỉnh)
      match.$or = [{ assignedTo: { $exists: false } }, { assignedTo: null }, { assignedTo: "" }];
    } else {
      // Nếu không truyền hoặc chọn "all" → lấy TẤT CẢ kể cả chưa giao
      match.$or = [
        { assignedTo: { $exists: true } },
        { assignedTo: { $exists: false } },
        { assignedTo: null },
        { assignedTo: "" },
      ];
    }

    if (province && province !== "all") {
      match.province = province;
    }

    if (collectionDate && collectionStatus === "collected") {
      const dateStr = String(collectionDate);

      dayjs.extend(utc);
      dayjs.extend(timezone);

      const startOfDay = dayjs.tz(dateStr, "Asia/Ho_Chi_Minh").startOf("day").toDate();
      const endOfDay = dayjs.tz(dateStr, "Asia/Ho_Chi_Minh").endOf("day").toDate();
      match.collectionDate = { $gte: startOfDay, $lte: endOfDay };
    }

    const searchConditions: any[] = [];

    if (customerCode && customerCode !== "") {
      // Tìm kiếm theo customerCode (Mã khách hàng)
      const regex = new RegExp(customerCode as string, "i");
      searchConditions.push({ invoiceNumber: regex });
    }

    if (stationCode && stationCode !== "") {
      // Tìm kiếm theo stationCode (Mã trạm)
      const regex = new RegExp(stationCode as string, "i");
      searchConditions.push({ recordBookCode: regex });
    }

    if (searchConditions.length > 0) {
      if (searchConditions.length === 1) {
        if (customerCode) {
          match.invoiceNumber = searchConditions[0].invoiceNumber;
        } else if (stationCode) {
          match.recordBookCode = searchConditions[0].recordBookCode;
        }
      } else if (searchConditions.length > 1) {
        if (!match.$and) match.$and = [];
        match.$and.push({
          $or: searchConditions, // Tìm hóa đơn thỏa mãn 1 trong 2 mã
        });
      } else if (searchConditions.length > 0) {
        if (!match.$and) match.$and = [];
        match.$and.push(searchConditions[0]);
      }
    }

    const defaultSort: any = {
      priority: -1,
      totalAmountNum: -1,
      issueDate: -1,
      _id: 1,
    };

    let sortStage: any = {};

    if (sortField && sortDirection && sortDirection !== "none") {
      const direction = sortDirection === "asc" ? 1 : -1;

      const dynamicSort: any = {};
      dynamicSort[sortField as string] = direction;

      sortStage = {
        ...dynamicSort,
        ...defaultSort,
      };
    } else {
      sortStage = defaultSort;
    }

    // Pipeline aggregate
    const pipeline: any[] = [
      { $match: match }, // dùng object match mới
      {
        $addFields: {
          totalAmountNum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$totalAmount", "Không nợ cước"] },
                  { $eq: ["$totalAmount", null] },
                  { $eq: ["$totalAmount", ""] },
                ],
              },
              0,
              {
                $toDouble: {
                  $replaceAll: {
                    input: "$totalAmount",
                    find: ",",
                    replacement: "",
                  },
                },
              },
            ],
          },
        },
      },
      {
        $addFields: {
          priority: {
            $cond: [
              {
                $and: [{ $eq: ["$collectionStatus", "not_collected"] }, { $gt: ["$totalAmountNum", 0] }],
              },
              1,
              0,
            ],
          },
        },
      },
      { $sort: sortStage },
      { $skip: skip },
      { $limit: limit },
    ];

    const result = await Invoice.aggregate(pipeline);

    const summaryAgg = [
      { $match: match },
      {
        $addFields: {
          totalAmountNum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$totalAmount", "Không nợ cước"] },
                  { $eq: ["$totalAmount", null] },
                  { $eq: ["$totalAmount", ""] },
                ],
              },
              0,
              {
                $toDouble: {
                  $replaceAll: { input: "$totalAmount", find: ",", replacement: "" },
                },
              },
            ],
          },
        },
      },
      {
        $facet: {
          // ✅ Nhóm hóa đơn đã có người nhận
          assigned: [
            {
              $match: {
                $and: [{ assignedTo: { $ne: null } }, { assignedTo: { $ne: "" } }],
              },
            },
            {
              $group: {
                _id: null,
                totalInvoices: { $sum: 1 },
                sumTotalAmount: { $sum: "$totalAmountNum" },
              },
            },
          ],
          // ✅ Nhóm hóa đơn chưa giao (rỗng, null, chưa có field)
          unassigned: [
            {
              $match: {
                $or: [{ assignedTo: { $exists: false } }, { assignedTo: null }, { assignedTo: "" }],
              },
            },
            {
              $group: {
                _id: null,
                totalInvoices: { $sum: 1 },
                sumTotalAmount: { $sum: "$totalAmountNum" },
              },
            },
          ],
        },
      },
    ];

    const summaryResult = await Invoice.aggregate(summaryAgg);

    const assignedSummary = summaryResult[0]?.assigned?.[0] || {};
    const unassignedSummary = summaryResult[0]?.unassigned?.[0] || {};

    // ✅ Tính toán từng giá trị với (|| 0)
    const assignedCount = assignedSummary.totalInvoices || 0;
    const unassignedCount = unassignedSummary.totalInvoices || 0; // Giống code cũ của bạn

    const assignedAmount = assignedSummary.sumTotalAmount || 0;
    const unassignedAmount = unassignedSummary.sumTotalAmount || 0;
    // ✅ Cộng các giá trị đã được đảm bảo là số
    const totalInvoices = assignedCount + unassignedCount;
    const sumTotalAmount = assignedAmount + unassignedAmount;

    // ✅ Populate thủ công
    await Invoice.populate(result, { path: "assignedTo", select: "fullName email phone collectionFee" });

    // ✅ Trả kết quả
    res.status(200).json({
      success: true,
      data: result,
      summary: {
        totalInvoices: totalInvoices,
        totalAmount: sumTotalAmount,
        unassignedInvoices: unassignedCount,
      },
      pagination: {
        currentPage: page,
        invoicesPerPage: limit,
        totalPages: Math.ceil(totalInvoices / limit),
      },
    });
  } catch (error) {
    console.error("fetchallInvoice error:", error);
    res.status(500).json({ message: "Lỗi server" });
  }
};

const addTotalAmountNumField = {
  $addFields: {
    totalAmountNum: {
      $cond: [
        {
          $or: [
            { $eq: ["$totalAmount", "Không nợ cước"] },
            { $eq: ["$totalAmount", null] },
            { $eq: ["$totalAmount", ""] },
          ],
        },
        0,
        {
          $toDouble: {
            $replaceAll: {
              input: "$totalAmount",
              find: ",",
              replacement: "",
            },
          },
        },
      ],
    },
  },
};
export const fetchTop20HighestInvoices = async (req: Request, res: Response) => {
  try {
    const userId = req.user?._id;
    const userRole = req.user?.role;
    const { collectionStatus } = req.query;
    const limit = 20; // Luôn lấy 20 hóa đơn

    const match: any = {};

    if (userRole !== "admin" && userId) {
      match.assignedTo = new mongoose.Types.ObjectId(userId as string);
    }

    if (collectionStatus) {
      match.collectionStatus = collectionStatus;
    }

    const pipeline: any[] = [
      { $match: match },
      addTotalAmountNumField,
      { $sort: { totalAmountNum: -1 } },
      { $limit: limit },
    ];

    const result = await Invoice.aggregate(pipeline);

    // ✅ Populate thủ công (Giữ lại logic populate)
    await Invoice.populate(result, { path: "assignedTo", select: "fullName email phone collectionFee" });

    // ✅ Trả kết quả
    res.status(200).json({
      success: true,
      message: `Đã lấy thành công ${result.length} hóa đơn nợ cước cao nhất.`,
      data: result,
    });
  } catch (error) {
    console.error("fetchTop20HighestInvoices error:", error);
    res.status(500).json({ message: "Lỗi server khi lấy top hóa đơn" });
  }
};

/**
 * Tìm kiếm hóa đơn theo Mã hóa đơn (chỉ trả về 20 kết quả).
 * GET /api/invoices/search
 */
// backend/controllers/invoiceController.ts

export const searchInvoice = async (req: Request, res: Response) => {
  try {
    const {
      collectionStatus,
      assignedUserId,
      userprovince,
      searchInvoiceNumber,
      searchType,
      page = 1,
      limit = 20,
    } = req.query;

    // Chuyển đổi sang số
    const pageNumber = parseInt(page as string, 10) || 1;
    const limitNumber = parseInt(limit as string, 10) || 20;
    const skip = (pageNumber - 1) * limitNumber;

    // 1. Tạo điều kiện lọc (Giữ nguyên logic của bạn)
    const match: any = {};

    match.totalAmount = { $regex: /^\d+(\.\d+)?$/ };

    if (collectionStatus && collectionStatus !== "all") {
      match.collectionStatus = collectionStatus;
    }
    if (assignedUserId && assignedUserId !== "all" && req.user?.role !== "admin") {
      match.$or = [
        { assignedTo: new mongoose.Types.ObjectId(assignedUserId as string) },
        {
          $and: [{ $or: [{ assignedTo: { $exists: false } }, { assignedTo: null }] }, { province: userprovince }],
        },
      ];
    }
    if (req.user?.role !== "admin") {
      match.isPaid = { $ne: true };
    }
    if (searchType && searchType === "station") {
      match.recordBookCode = { $regex: new RegExp(searchInvoiceNumber as string, "i") };
    } else if (searchType && searchType === "customer") {
      match.invoiceNumber = { $regex: new RegExp(searchInvoiceNumber as string, "i") };
    } else if (searchType && searchType === "customerName") {
      match.customerName = { $regex: new RegExp(searchInvoiceNumber as string, "i") };
    }

    // 2. Thực thi song song 3 truy vấn để tối ưu tốc độ
    const [invoices, totalCount, totalAmountResult] = await Promise.all([
      // Query 1: Lấy danh sách phân trang (Data)
      Invoice.find(match)
        .populate("assignedTo", "fullName email phone collectionFee")
        .collation({ locale: "en_US", numericOrdering: true })
        .sort({ totalAmount: -1 })
        .skip(skip)
        .limit(limitNumber),

      // Query 2: Đếm tổng số bản ghi (Count)
      Invoice.countDocuments(match),

      // Query 3: Tính tổng tiền toàn bộ kết quả tìm thấy (Sum)
      Invoice.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: { $toDouble: "$totalAmount" } },
          },
        },
      ]),
    ]);

    const totalRevenue = totalAmountResult.length > 0 ? totalAmountResult[0].total : 0;

    // 3. Trả về kết quả
    res.status(200).json({
      success: true,
      data: invoices,
      count: invoices.length,
      total: totalCount,
      totalAmount: totalRevenue,
      totalPages: Math.ceil(totalCount / limitNumber),
      currentPage: pageNumber,
    });
  } catch (error) {
    console.error("searchInvoice error:", error);
    res.status(500).json({ success: false, message: "Lỗi server khi tìm kiếm hóa đơn" });
  }
};

/**
 * Tìm kiếm hóa đơn ĐÃ THU theo ngày.
 * GET /api/invoices/searchByDate
 */
export const searchInvoicesByDate = async (req: Request, res: Response) => {
  try {
    const { assignedUserId, userprovince, selectedDate } = req.query;
    const user = req.user; // user đã được middleware auth gắn vào

    if (!user) {
      return res.status(400).json({ message: "Không xác định được người dùng." });
    }

    // Kiểm tra tham số bắt buộc
    if (!assignedUserId || !selectedDate) {
      return res.status(400).json({ message: "Thiếu tham số bắt buộc." });
    }

    // Thiếu province chỉ hợp lệ nếu user là admin
    if (!userprovince && user?.role !== "admin") {
      return res.status(400).json({ message: "Thiếu thông tin tỉnh thành." });
    }

    // Cấu hình timezone
    dayjs.extend(utc);
    dayjs.extend(timezone);

    const dateStr = String(selectedDate);
    const startOfDay = dayjs.tz(dateStr, "Asia/Ho_Chi_Minh").startOf("day").toDate();
    const endOfDay = dayjs.tz(dateStr, "Asia/Ho_Chi_Minh").endOf("day").toDate();

    // console.log("Ngày truy vấn:", { startOfDay, endOfDay });

    // Xây dựng điều kiện tìm kiếm động
    const query: any = {
      collectionStatus: "collected",
      collectionDate: { $gte: startOfDay, $lte: endOfDay },
    };

    // Nếu KHÔNG phải admin thì thêm điều kiện theo tỉnh
    if (user?.role !== "admin") {
      query.province = userprovince;
      query.assignedTo = assignedUserId;
    }

    const invoices = await Invoice.find(query)
      .populate("assignedTo", "fullName email phone collectionFee")
      .sort({ collectionDate: -1 });

    res.status(200).json({ data: invoices });
  } catch (error) {
    console.error("Lỗi searchByDate:", error);
    res.status(500).json({ message: "Lỗi khi tìm hóa đơn theo ngày." });
  }
};

/**
 * Lấy tổng hợp trạng thái thu/chưa thu.
 * GET /api/invoices/summary?userId=...
 */
export const getInvoiceSummary = async (req: Request, res: Response) => {
  const { userId } = req.query;

  try {
    const matchStage: any = {};

    // ✅ Nếu có userId → chỉ lấy hóa đơn của người đó
    if (userId && typeof userId === "string" && mongoose.Types.ObjectId.isValid(userId)) {
      matchStage.assignedTo = new mongoose.Types.ObjectId(userId);
    }

    // Dùng aggregate để tính tổng hợp
    const result = await Invoice.aggregate([
      ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),

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

/**
 * Lấy kỳ hoá đơn mới nhất.
 * GET /api/invoices/latest-period
 */
export const getLatestBillingPeriod = async (req: Request, res: Response) => {
  try {
    const latestInvoice = await Invoice.findOne({
      billing_period: { $exists: true, $ne: "" },
    }).sort({ updatedAt: -1 });

    if (!latestInvoice) {
      // Nếu chưa có dữ liệu nào hợp lệ thì mặc định là tháng hiện tại
      const now = new Date();
      const defaultPeriod = `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
      return res.json({ billing_period: defaultPeriod });
    }

    // console.log(latestInvoice);
    res.json({ billing_period: latestInvoice.billing_period });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Lỗi server" });
  }
};
