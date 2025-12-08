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
    // 1. Validate User
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: "Bạn chưa đăng nhập hoặc token không hợp lệ.",
      });
    }

    const { collectionStatus } = req.query;

    // 2. Xây dựng Match Query (BỎ Regex totalAmount tại đây)
    const matchQuery: any = {
      collectionStatus: collectionStatus || "not_collected",
      // Chỉ lấy những dòng có mã trạm, không bị null/rỗng
      recordBookCode: { $exists: true, $ne: "" },
    };

    // Kiểm tra quyền: Nếu KHÔNG PHẢI admin thì lọc theo user
    if (req.user.role !== "admin") {
      matchQuery.assignedTo = new mongoose.Types.ObjectId(req.user._id.toString());
    }

    // 3. Aggregate Tối ưu
    const topStations = await Invoice.aggregate([
      // Bước 1: Filter nhanh bằng Index (assignedTo, collectionStatus)
      { $match: matchQuery },

      // Bước 2: Group và tính tổng an toàn
      {
        $group: {
          _id: "$recordBookCode",
          totalAmount: {
            $sum: {
              $cond: [
                // Nếu totalAmount là chuỗi rỗng hoặc null -> tính là 0
                { $in: ["$totalAmount", [null, "", "Không nợ cước"]] },
                0,
                {
                  // Convert an toàn: Bỏ dấu phẩy rồi chuyển sang số
                  // Nếu lỗi (vd: chứa chữ cái lạ) -> trả về 0 (nhờ onError)
                  $convert: {
                    input: { $replaceAll: { input: "$totalAmount", find: ",", replacement: "" } },
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
              ],
            },
          },
          count: { $sum: 1 },
        },
      },

      // Bước 3: Sắp xếp giảm dần theo tổng tiền
      {
        $sort: { totalAmount: -1 },
      },

      // Bước 4: Lấy top 3
      {
        $limit: 3,
      },

      // Bước 5: Format lại dữ liệu đầu ra
      {
        $project: {
          _id: 0,
          stationName: "$_id",
          totalAmount: 1,
          count: 1,
        },
      },
    ]);

    // 4. Trả về kết quả
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
        // Hóa đơn đã được giao cho chính người đó
        { assignedTo: new mongoose.Types.ObjectId(assignedUser as string) },

        // Hóa đơn chưa giao + cùng tỉnh
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
      // Nếu chọn "no_one" → chỉ lấy hóa đơn chưa giao (bỏ điều kiện tỉnh nếu bạn không muốn lọc theo tỉnh)
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
    const result = await Invoice.aggregate([
      // A. Lọc dữ liệu đầu vào
      { $match: match },

      // B. Tính toán các trường số học (Làm 1 lần duy nhất cho cả sort và sum)
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
        $addFields: {
          priority: {
            $cond: [{ $and: [{ $eq: ["$collectionStatus", "not_collected"] }, { $gt: ["$totalAmountNum", 0] }] }, 1, 0],
          },
        },
      },

      // C. FACET: Chia luồng xử lý song song
      {
        $facet: {
          // Luồng 1: Lấy danh sách hiển thị (Data + Pagination)
          data: [
            { $sort: sortStage },
            { $skip: skip },
            { $limit: limit },
            // Thay thế Invoice.populate bằng $lookup trực tiếp
            {
              $lookup: {
                from: "users", // Tên collection trong DB (thường là 'users' số nhiều)
                localField: "assignedTo",
                foreignField: "_id",
                as: "assignedInfo",
                pipeline: [{ $project: { fullName: 1, email: 1, phone: 1, collectionFee: 1 } }],
              },
            },
            // Unwind để biến mảng assignedInfo thành object (nếu có)
            { $unwind: { path: "$assignedInfo", preserveNullAndEmptyArrays: true } },
            // Gán ngược lại vào assignedTo để giống format cũ
            { $addFields: { assignedTo: "$assignedInfo" } },
            { $project: { assignedInfo: 0 } }, // Xóa field thừa
          ],

          // Luồng 2: Tính tổng hợp (Summary)
          summary: [
            {
              $group: {
                _id: null,
                totalInvoices: { $sum: 1 }, // Tổng số hóa đơn
                sumTotalAmount: { $sum: "$totalAmountNum" }, // Tổng tiền
                // Đếm số lượng chưa giao (unassigned)
                unassignedCount: {
                  $sum: {
                    $cond: [
                      {
                        $or: [
                          { $eq: ["$assignedTo", null] },
                          { $eq: ["$assignedTo", ""] },
                          { $eq: [{ $type: "$assignedTo" }, "missing"] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    ]);

    const facetResult = result[0];
    const data = facetResult.data;
    const summaryData = facetResult.summary[0] || { totalInvoices: 0, sumTotalAmount: 0, unassignedCount: 0 };

    // ✅ Trả kết quả
    res.status(200).json({
      success: true,
      data: data,
      summary: {
        totalInvoices: summaryData.totalInvoices,
        totalAmount: summaryData.sumTotalAmount,
        unassignedInvoices: summaryData.unassignedCount,
      },
      pagination: {
        currentPage: page,
        invoicesPerPage: limit,
        totalPages: Math.ceil(summaryData.totalInvoices / limit),
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
    const limit = 20;

    const match: any = {};
    if (userRole !== "admin" && userId) {
      match.assignedTo = new mongoose.Types.ObjectId(userId as string);
    }
    if (collectionStatus) {
      match.collectionStatus = collectionStatus;
    }

    // Chỉ lấy những thằng có totalAmount và khác rỗng để đỡ lỗi convert
    match.totalAmount = { $exists: true, $ne: "" };

    match.isPaid = false;

    const result = await Invoice.aggregate([
      { $match: match },
      // Convert String -> Number (Vẫn phải làm bước này nếu DB chưa sửa)
      {
        $addFields: {
          realAmount: {
            $cond: [
              { $regexMatch: { input: "$totalAmount", regex: /^[0-9,.]+$/ } }, // Kiểm tra an toàn
              { $toDouble: { $replaceAll: { input: "$totalAmount", find: ",", replacement: "" } } },
              0,
            ],
          },
        },
      },
      // Sort trên số thực
      { $sort: { realAmount: -1 } },
      { $limit: limit },
      // Lookup thay vì populate
      {
        $lookup: {
          from: "users",
          localField: "assignedTo",
          foreignField: "_id",
          as: "assignedToInfo",
          pipeline: [{ $project: { fullName: 1, email: 1, phone: 1, collectionFee: 1 } }],
        },
      },
      { $unwind: { path: "$assignedToInfo", preserveNullAndEmptyArrays: true } },
      { $addFields: { assignedTo: "$assignedToInfo" } },
      { $project: { assignedToInfo: 0, realAmount: 0 } }, // Xóa field tạm
    ]);

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

    if (searchInvoiceNumber) {
      const regex = new RegExp(searchInvoiceNumber as string, "i");
      if (searchType === "station") {
        match.recordBookCode = { $regex: regex };
      } else if (searchType === "customer") {
        match.invoiceNumber = { $regex: regex };
      } else if (searchType === "customerName") {
        match.customerName = { $regex: regex };
      }
    }

    const result = await Invoice.aggregate([
      // Bước 1: Lọc dữ liệu
      { $match: match },

      // Bước 2: Tạo field số để Sort và tính tổng cho chính xác
      {
        $addFields: {
          amountVal: {
            $cond: [
              // Kiểm tra xem có phải dạng số không (để tránh lỗi crash)
              { $regexMatch: { input: "$totalAmount", regex: /^[0-9,.]+$/ } },
              { $toDouble: { $replaceAll: { input: "$totalAmount", find: ",", replacement: "" } } },
              0,
            ],
          },
        },
      },

      // Bước 3: Facet - Chia luồng
      {
        $facet: {
          // Luồng A: Lấy data chi tiết (Data)
          data: [
            { $sort: { amountVal: -1, _id: -1 } }, // Sort theo tiền giảm dần
            { $skip: skip },
            { $limit: limitNumber },
            // Lookup User
            {
              $lookup: {
                from: "users",
                localField: "assignedTo",
                foreignField: "_id",
                as: "assignedInfo",
                pipeline: [{ $project: { fullName: 1, email: 1, phone: 1, collectionFee: 1 } }],
              },
            },
            { $unwind: { path: "$assignedInfo", preserveNullAndEmptyArrays: true } },
            { $addFields: { assignedTo: "$assignedInfo" } },
            { $project: { assignedInfo: 0, amountVal: 0 } }, // Xóa field tạm
          ],

          // Luồng B: Thống kê tổng (Count & Sum)
          meta: [
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                totalAmount: { $sum: "$amountVal" },
              },
            },
          ],
        },
      },
    ]);

    const data = result[0].data;
    const meta = result[0].meta[0] || { count: 0, totalAmount: 0 };

    // 3. Trả về kết quả
    res.status(200).json({
      success: true,
      data: data,
      count: data.length,
      total: meta.count,
      totalAmount: meta.totalAmount,
      totalPages: Math.ceil(meta.count / limitNumber),
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
    const {
      assignedUserId,
      userprovince,
      selectedDate,
      page = 1, // Mặc định trang 1
      limit = 20, // Mặc định 20 dòng
    } = req.query;

    const user = req.user;

    if (!user) {
      return res.status(400).json({ success: false, message: "Không xác định được người dùng." });
    }

    // Kiểm tra tham số bắt buộc
    if (!assignedUserId || !selectedDate) {
      return res.status(400).json({ success: false, message: "Thiếu tham số bắt buộc." });
    }

    // Thiếu province chỉ hợp lệ nếu user là admin
    if (!userprovince && user?.role !== "admin") {
      return res.status(400).json({ success: false, message: "Thiếu thông tin tỉnh thành." });
    }

    // 1. Xử lý phân trang
    const pageNumber = parseInt(page as string, 10) || 1;
    const limitNumber = parseInt(limit as string, 10) || 20;
    const skip = (pageNumber - 1) * limitNumber;

    // 2. Xử lý thời gian (Timezone)
    dayjs.extend(utc);
    dayjs.extend(timezone);

    const dateStr = String(selectedDate);
    const startOfDay = dayjs.tz(dateStr, "Asia/Ho_Chi_Minh").startOf("day").toDate();
    const endOfDay = dayjs.tz(dateStr, "Asia/Ho_Chi_Minh").endOf("day").toDate();

    // 3. Xây dựng điều kiện lọc (Match Query)
    const match: any = {
      collectionStatus: "collected",
      collectionDate: { $gte: startOfDay, $lte: endOfDay },
    };

    // Nếu KHÔNG phải admin thì thêm điều kiện theo tỉnh và người được giao
    if (user?.role !== "admin") {
      match.province = userprovince;
      // Lưu ý: Khi dùng aggregate, nên ép kiểu ObjectId để đảm bảo chính xác
      match.assignedTo = new mongoose.Types.ObjectId(assignedUserId as string);
    }
    // Nếu bạn muốn Admin cũng lọc theo assignedUserId khi có truyền lên, hãy mở comment dòng dưới:
    // else if (assignedUserId) { match.assignedTo = new mongoose.Types.ObjectId(assignedUserId as string); }

    // 4. Thực thi song song 3 truy vấn (Data, Count, Sum Amount)
    const result = await Invoice.aggregate([
      // Bước 1: Lọc dữ liệu
      { $match: match },

      // Bước 2: Facet - Chia luồng xử lý
      {
        $facet: {
          // Luồng A: Lấy data (Data)
          data: [
            { $sort: { collectionDate: -1, _id: -1 } },
            { $skip: skip },
            { $limit: limitNumber },
            // Lookup user trực tiếp
            {
              $lookup: {
                from: "users",
                localField: "assignedTo",
                foreignField: "_id",
                as: "assignedInfo",
                pipeline: [{ $project: { fullName: 1, email: 1, phone: 1, collectionFee: 1 } }],
              },
            },
            { $unwind: { path: "$assignedInfo", preserveNullAndEmptyArrays: true } },
            { $addFields: { assignedTo: "$assignedInfo" } },
            { $project: { assignedInfo: 0 } },
          ],

          // Luồng B: Thống kê (Meta)
          meta: [
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                // Tính tổng tiền (Convert string -> number tại chỗ)
                totalAmount: {
                  $sum: {
                    $cond: [
                      { $regexMatch: { input: "$totalAmount", regex: /^[0-9,.]+$/ } },
                      { $toDouble: { $replaceAll: { input: "$totalAmount", find: ",", replacement: "" } } },
                      0,
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    ]);

    const data = result[0].data;
    const meta = result[0].meta[0] || { count: 0, totalAmount: 0 };

    // 5. Trả về kết quả đúng định dạng yêu cầu
    res.status(200).json({
      success: true,
      data: data,
      count: data.length, // Số bản ghi của trang hiện tại
      total: meta.count, // Tổng số bản ghi tìm thấy trong DB
      totalAmount: meta.totalAmount, // Tổng tiền
      totalPages: Math.ceil(meta.count / limitNumber),
      currentPage: pageNumber,
    });
  } catch (error) {
    console.error("Lỗi searchInvoicesByDate:", error);
    res.status(500).json({ success: false, message: "Lỗi khi tìm hóa đơn theo ngày." });
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

    if (userId && typeof userId === "string" && mongoose.Types.ObjectId.isValid(userId)) {
      matchStage.assignedTo = new mongoose.Types.ObjectId(userId);
    }

    // Dùng aggregate để tính tổng hợp
    const result = await Invoice.aggregate([
      // 1. MATCH: Lọc bớt dữ liệu nếu cần (ví dụ chỉ lấy của 1 user)
      // Nếu không có userId, bước này sẽ pass qua 17k dòng xuống dưới
      ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),

      // 2. GROUP (QUAN TRỌNG NHẤT): Xử lý 17k dòng tại đây
      {
        $group: {
          _id: "$assignedTo", // Gom nhóm theo ID nhân viên

          // Vì chỉ có 1 tháng nên ta lấy luôn giá trị đầu tiên tìm thấy làm đại diện
          billing_period: { $first: "$billing_period" },

          // Đếm số lượng
          collectedCount: {
            $sum: { $cond: [{ $eq: ["$collectionStatus", "collected"] }, 1, 0] },
          },
          notCollectedCount: {
            $sum: { $cond: [{ $eq: ["$collectionStatus", "not_collected"] }, 1, 0] },
          },

          // Tính tổng tiền (Vẫn giữ convert nếu DB chưa sửa, nhưng gom trước nên nhanh hơn)
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

      // 3. LOOKUP: Bây giờ mới đi tìm thông tin User
      {
        $lookup: {
          from: "users",
          localField: "_id", // _id của group chính là assignedTo cũ (trường _id đã được gom nhóm phía trên)
          foreignField: "_id",
          as: "userInfo",
          pipeline: [
            { $project: { password: 0, pass: 0, __v: 0 } }, // Chỉ lấy thông tin cần thiết
          ],
        },
      },

      // 4. UNWIND: Trải phẳng mảng userInfo (vì lookup luôn trả về mảng)
      { $unwind: { path: "$userInfo", preserveNullAndEmptyArrays: true } },

      // 5. PROJECT: Trình bày lại dữ liệu trả về cho Client
      {
        $project: {
          _id: 0, // Ẩn cái ID lằng nhằng đi
          assignedTo: "$userInfo", // Trả về object user đầy đủ
          billing_period: 1,
          collectedCount: 1,
          notCollectedCount: 1,
          collectedTotal: 1,
          notCollectedTotal: 1,
        },
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
