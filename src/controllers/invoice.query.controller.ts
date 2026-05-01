import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { Request, Response } from "express";
import mongoose from "mongoose";
import Invoice from "../models/invoiceModel";

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
      .populate("assignedTo", "fullName  phone collectionFee") // Nếu muốn lấy thêm thông tin người được chỉ định
      .sort({ billing_period: -1, excelRowIndex: 1 });

    // 4️⃣ Trả về dữ liệu
    res.status(200).json(invoices);
  } catch (error) {
    console.error("Lỗi khi lấy hoá đơn:", error);
    res.status(500).json({
      success: false,
      message: "Đã có lỗi xảy ra khi lấy dữ liệu hoá đơn.",
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
      .populate("assignedTo", "fullName  phone collectionFee") // Nếu muốn lấy thêm thông tin người được chỉ định
      .sort({ billing_period: -1, excelRowIndex: 1 });

    // 4️⃣ Trả về dữ liệu
    res.status(200).json(invoices);
  } catch (error) {
    console.error("Lỗi khi lấy hoá đơn:", error);
    res.status(500).json({
      success: false,
      message: "Đã có lỗi xảy ra khi lấy dữ liệu hoá đơn.",
    });
  }
};

export const fetchAllUnColInvoiceByUser = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: "Bạn chưa đăng nhập hoặc token không hợp lệ.",
      });
    }

    const invoices = await Invoice.find({ assignedTo: req.user._id, collectionStatus: "not_collected" })
      .populate("assignedTo", "fullName  phone collectionFee")
      .sort({ billing_period: -1, excelRowIndex: 1 });

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
        $sort: { count: -1, _id: 1 },
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
      .populate("assignedTo", "fullName  phone collectionFee") // Nếu muốn lấy thêm thông tin người được chỉ định
      .sort({ billing_period: -1, excelRowIndex: 1 });

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
    }).populate("assignedTo", "fullName  phone collectionFee"); // Nếu muốn lấy thêm thông tin người được chỉ định

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
    }).populate("assignedTo", "fullName  phone collectionFee"); // Nếu muốn lấy thêm thông tin người được chỉ định

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
      onlyDuplicates,
    } = req.query;

    const hasFilter = !!((printStatus && printStatus !== "all") || (collectionStatus && collectionStatus !== "all"));

    const page = parseInt(currentPage as string, 10) || 1;
    const limit = parseInt(invoicesPerPage as string, 10) || 20;
    const skip = (page - 1) * limit;

    let assignedUser = assignedUserId;
    const match: any = {};

    if (req.user?.role === "admin") {
      if (isPaid === "true") {
        match.isPaid = true;
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

    if (assignedUser && assignedUser !== "all" && assignedUser !== "no_one" && req.user?.role === "admin") {
      match.$or = [
        // Hóa đơn đã được giao cho chính người đó
        { assignedTo: new mongoose.Types.ObjectId(assignedUser as string) },

        {
          $and: [
            {
              $or: [{ assignedTo: { $exists: false } }, { assignedTo: null }, { assignedTo: "" }],
            },
            { province: userprovince },
          ],
        },
      ];
    } else if (assignedUser === "no_one") {
      match.$or = [{ assignedTo: { $exists: false } }, { assignedTo: null }, { assignedTo: "" }];
    } else {
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

    // ✅ Filter "Mã trùng": chỉ lấy các hóa đơn có invoiceNumber trùng (>=2 bản ghi toàn DB)
    if (onlyDuplicates === "true") {
      const dupAgg = await Invoice.aggregate([
        { $match: { invoiceNumber: { $nin: [null, ""] } } },
        { $group: { _id: "$invoiceNumber", c: { $sum: 1 } } },
        { $match: { c: { $gt: 1 } } },
        { $project: { _id: 1 } },
      ]);
      const dupNums = dupAgg.map((d: any) => d._id);
      match.invoiceNumber = { $in: dupNums.length > 0 ? dupNums : ["___no_match___"] };
    }

    // ✅ Mặc định ẨN hóa đơn có totalAmount = 0 / rỗng (chuyển sang Danh sách tổng).
    // Có thể bypass bằng query ?includeZero=true.
    const includeZero = String((req.query as any).includeZero || "") === "true";
    if (!includeZero) {
      if (!match.$and) match.$and = [];
      match.$and.push({ totalAmount: { $nin: [null, "", "0", "0.0", "0.00", 0] } });
    }

    const defaultSort: any = { sortPriority: -1, excelRowIndex: 1, excelOrder: 1, _id: 1 };

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
            $let: {
              vars: {
                cleaned: {
                  $trim: {
                    input: {
                      $replaceAll: {
                        input: {
                          $toString: { $ifNull: ["$totalAmount", "0"] },
                        },
                        find: ",",
                        replacement: "",
                      },
                    },
                  },
                },
              },
              in: {
                $cond: [
                  {
                    $or: [{ $eq: ["$$cleaned", ""] }, { $regexMatch: { input: "$$cleaned", regex: /^[^\d.-]+$/ } }],
                  },
                  0,
                  {
                    $convert: {
                      input: "$$cleaned",
                      to: "double",
                      onError: 0,
                      onNull: 0,
                    },
                  },
                ],
              },
            },
          },
        },
      },

      {
        $addFields: {
          priority: {
            $cond: {
              if: { $eq: [hasFilter, true] }, // Nếu CÓ bộ lọc thì mới gán nhãn
              then: {
                $switch: {
                  branches: [
                    {
                      case: {
                        $and: [
                          { $eq: ["$collectionStatus", "not_collected"] },
                          { $ne: ["$isPaid", true] },
                          { $gt: ["$totalAmountNum", 0] },
                        ],
                      },
                      then: 2,
                    },
                    {
                      case: { $and: [{ $eq: ["$collectionStatus", "not_collected"] }, { $eq: ["$isPaid", true] }] },
                      then: 1,
                    },
                  ],
                  default: 0,
                },
              },
              else: 0,
            },
          },
          sortPriority: { $ifNull: ["$sortPriority", 0] }, // Đảm bảo sortPriority có giá trị mặc định
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
                pipeline: [{ $project: { fullName: 1, phone: 1, collectionFee: 1 } }],
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
                totalInvoices: { $sum: 1 },
                sumTotalAmount: { $sum: "$totalAmountNum" },
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

          // Luồng 3: Danh sách mã hóa đơn trùng (invoiceNumber xuất hiện >=2 lần)
          duplicates: [
            { $match: { invoiceNumber: { $nin: [null, ""] } } },
            { $group: { _id: "$invoiceNumber", c: { $sum: 1 } } },
            { $match: { c: { $gt: 1 } } },
            { $project: { _id: 0, invoiceNumber: "$_id" } },
          ],
        },
      },
    ]);

    const facetResult = result[0];
    const data = facetResult.data;
    const summaryData = facetResult.summary[0] || {
      totalInvoices: 0,
      sumTotalAmount: 0,
      unassignedCount: 0,
    };
    const duplicateInvoiceNumbers: string[] = (facetResult.duplicates || [])
      .map((d: any) => d.invoiceNumber)
      .filter(Boolean);

    res.status(200).json({
      success: true,
      data: data,
      summary: {
        totalInvoices: summaryData.totalInvoices,
        totalAmount: summaryData.sumTotalAmount,
        unassignedInvoices: summaryData.unassignedCount,
      },
      duplicateInvoiceNumbers,
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

export const fetchUserInvoices = async (req: Request, res: Response) => {
  try {
    const {
      currentPage = "1",
      invoicesPerPage = "20",
      printStatus,
      collectionStatus,
      province,
      customerCode,
      stationCode,
      collectionDate,
      sortField,
      sortDirection,
      isPaid,
    } = req.query;

    const targetUserId = req.user?._id;

    if (!targetUserId) {
      return res.status(400).json({ message: "Thiếu thông tin người dùng" });
    }

    const page = parseInt(currentPage as string, 10) || 1;
    const limit = parseInt(invoicesPerPage as string, 10) || 20;
    const skip = (page - 1) * limit;

    const match: any = {
      assignedTo: new mongoose.Types.ObjectId(targetUserId as string),
    };

    // 🔎 Khi NPT đang TÌM KIẾM (theo Mã KH / Mã trạm) → bỏ ràng buộc assignedTo
    // để có thể tra cứu hóa đơn của KH bất kỳ (kể cả thuộc NPT khác hoặc trong danh sách tổng).
    const hasSearch = !!((customerCode && String(customerCode).trim()) || (stationCode && String(stationCode).trim()));
    if (hasSearch) {
      delete match.assignedTo;
    }

    // User page: chỉ lọc "đã đóng cước" khi client gửi isPaid=true.
    // Nếu isPaid=false hoặc không có param thì không áp điều kiện, để hiển thị đầy đủ dữ liệu được giao.
    const isPaidParam = String(isPaid ?? "").toLowerCase();
    if (isPaidParam === "true") {
      match.isPaid = true;
    }

    if (printStatus && printStatus !== "all") {
      match.printStatus = printStatus === "not_printed" ? { $ne: "printed" } : "printed";
    }

    if (collectionStatus && collectionStatus !== "all") {
      match.collectionStatus = collectionStatus;
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
    if (customerCode) searchConditions.push({ invoiceNumber: new RegExp(customerCode as string, "i") });
    if (stationCode) searchConditions.push({ recordBookCode: new RegExp(stationCode as string, "i") });

    if (searchConditions.length > 0) {
      match.$or = searchConditions;
    }

    const defaultSort: any = { sortPriority: -1, excelRowIndex: 1, excelOrder: 1, _id: 1 };
    let sortStage = defaultSort;
    if (sortField && sortDirection && sortDirection !== "none") {
      sortStage = { [sortField as string]: sortDirection === "asc" ? 1 : -1, ...defaultSort };
    }

    const result = await Invoice.aggregate([
      { $match: match },
      {
        $addFields: {
          totalAmountNum: {
            $let: {
              vars: {
                cleaned: {
                  $trim: {
                    input: {
                      $replaceAll: {
                        input: { $toString: { $ifNull: ["$totalAmount", "0"] } },
                        find: ",",
                        replacement: "",
                      },
                    },
                  },
                },
              },
              in: {
                $cond: [
                  { $or: [{ $eq: ["$$cleaned", ""] }, { $regexMatch: { input: "$$cleaned", regex: /^[^\d.-]+$/ } }] },
                  0,
                  { $convert: { input: "$$cleaned", to: "double", onError: 0, onNull: 0 } },
                ],
              },
            },
          },
        },
      },
      {
        $facet: {
          data: [{ $sort: sortStage }, { $skip: skip }, { $limit: limit }],
          summary: [
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
    ]);

    const facetResult = result[0];
    const data = facetResult.data;
    const summaryData = facetResult.summary[0] || { totalInvoices: 0, sumTotalAmount: 0 };

    // 🔎 Khi đang TÌM KIẾM, kèm thêm KH chỉ có trong "Danh sách tổng" (CustomerMaster)
    // — tức KH đã thu xong / chưa có hóa đơn kỳ hiện tại.
    let masterMatches: any[] = [];
    if (hasSearch) {
      try {
        const CustomerMaster = require("../models/customerMasterModel").default;
        const masterMatch: any = {};
        const masterOr: any[] = [];
        if (customerCode && String(customerCode).trim()) {
          masterOr.push({ invoiceNumber: new RegExp(String(customerCode).trim(), "i") });
          masterOr.push({ customerName: new RegExp(String(customerCode).trim(), "i") });
        }
        if (stationCode && String(stationCode).trim()) {
          masterOr.push({ recordBookCode: new RegExp(String(stationCode).trim(), "i") });
        }
        if (masterOr.length) masterMatch.$or = masterOr;
        const seen = new Set(data.map((d: any) => String(d.invoiceNumber)));
        const masters = await CustomerMaster.find(masterMatch)
          .limit(50)
          .populate("assignedTo", "fullName username")
          .lean();
        masterMatches = masters.filter((m: any) => !seen.has(String(m.invoiceNumber)));
      } catch (e) {
        console.error("master search err:", e);
      }
    }

    res.status(200).json({
      success: true,
      data,
      masterMatches,
      summary: {
        totalInvoices: summaryData.totalInvoices,
        totalAmount: summaryData.sumTotalAmount,
      },
      pagination: {
        currentPage: page,
        invoicesPerPage: limit,
        totalPages: Math.ceil(summaryData.totalInvoices / limit),
      },
    });
  } catch (error) {
    console.error("fetchUserInvoices error:", error);
    res.status(500).json({ message: "Lỗi server" });
  }
};

export const fetchInvoicesByList = async (req: Request, res: Response) => {
  try {
    const {
      printStatus,
      collectionStatus,
      assignedUserId,
      province,
      userprovince,
      collectionDate,
      sortField,
      sortDirection,
      isPaid,
    } = req.query;

    const { codes, searchType } = req.body;

    const page = 1;

    let assignedUser = assignedUserId;
    const match: any = {};

    if (req.user?.role === "admin") {
      if (typeof assignedUser !== "string" || !assignedUser.trim()) {
        assignedUser = "all";
      }
      if (isPaid === "true") match.isPaid = true;
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
      match.$or = [
        { assignedTo: new mongoose.Types.ObjectId(assignedUser as string) },
        {
          $and: [
            { $or: [{ assignedTo: { $exists: false } }, { assignedTo: null }, { assignedTo: "" }] },
            { province: userprovince },
          ],
        },
      ];
    } else if (assignedUser === "no_one") {
      match.$or = [{ assignedTo: { $exists: false } }, { assignedTo: null }, { assignedTo: "" }];
    } else {
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

    if (codes && Array.isArray(codes) && codes.length > 0) {
      if (searchType === "stationCode") {
        match.recordBookCode = { $in: codes };
      } else {
        match.invoiceNumber = { $in: codes };
      }
    } else {
    }

    const defaultSort: any = { sortPriority: -1, excelRowIndex: 1, excelOrder: 1, _id: 1 };

    let sortStage: any = {};
    if (sortField && sortDirection && sortDirection !== "none") {
      const direction = sortDirection === "asc" ? 1 : -1;
      const dynamicSort: any = {};
      dynamicSort[sortField as string] = direction;
      sortStage = { ...dynamicSort, ...defaultSort };
    } else {
      sortStage = defaultSort;
    }

    const result = await Invoice.aggregate([
      { $match: match },
      {
        $addFields: {
          totalAmountNum: {
            $let: {
              vars: {
                cleaned: {
                  $trim: {
                    input: {
                      $replaceAll: {
                        input: { $toString: { $ifNull: ["$totalAmount", "0"] } },
                        find: ",",
                        replacement: "",
                      },
                    },
                  },
                },
              },
              in: {
                $cond: [
                  { $or: [{ $eq: ["$$cleaned", ""] }, { $regexMatch: { input: "$$cleaned", regex: /^[^\d.-]+$/ } }] },
                  0,
                  { $convert: { input: "$$cleaned", to: "double", onError: 0, onNull: 0 } },
                ],
              },
            },
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
      {
        $facet: {
          data: [
            { $sort: sortStage },
            {
              $lookup: {
                from: "users",
                localField: "assignedTo",
                foreignField: "_id",
                as: "assignedInfo",
                pipeline: [{ $project: { fullName: 1, phone: 1, collectionFee: 1 } }],
              },
            },
            { $unwind: { path: "$assignedInfo", preserveNullAndEmptyArrays: true } },
            { $addFields: { assignedTo: "$assignedInfo" } },
            { $project: { assignedInfo: 0 } },
          ],
          summary: [
            {
              $group: {
                _id: null,
                totalInvoices: { $sum: 1 },
                sumTotalAmount: { $sum: "$totalAmountNum" },
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
    const summaryData = facetResult.summary[0] || {
      totalInvoices: 0,
      sumTotalAmount: 0,
      unassignedCount: 0,
    };

    res.status(200).json({
      success: true,
      data: data,
      summary: {
        totalInvoices: summaryData.totalInvoices,
        totalAmount: summaryData.sumTotalAmount,
        unassignedInvoices: summaryData.unassignedCount,
      },
      pagination: {
        currentPage: 1,
        invoicesPerPage: data.length,
        totalPages: 1,
      },
    });
  } catch (error) {
    console.error("fetchInvoicesByList error:", error);
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
      { $sort: { sortPriority: -1, excelRowIndex: 1, excelOrder: 1, _id: 1 } },
      { $limit: limit },
      // Lookup thay vì populate
      {
        $lookup: {
          from: "users",
          localField: "assignedTo",
          foreignField: "_id",
          as: "assignedToInfo",
          pipeline: [{ $project: { fullName: 1, phone: 1, collectionFee: 1 } }],
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
      limit = 100, // Tăng limit mặc định lên 100 cho phù hợp với yêu cầu
    } = req.query;

    // Chuyển đổi sang số
    const pageNumber = parseInt(page as string, 10) || 1;
    const limitNumber = parseInt(limit as string, 10) || 100;
    const skip = (pageNumber - 1) * limitNumber;

    // 1. Tạo điều kiện lọc
    const match: any = {};

    // Xử lý collectionStatus - Lọc theo trạng thái thu tiền
    if (collectionStatus && collectionStatus !== "all") {
      match.collectionStatus = collectionStatus;
    }

    // Xử lý param isPaid - cho phép lọc hóa đơn đã đóng cước
    const isPaidParam = req.query.isPaid;
    if (isPaidParam === "true") {
      match.isPaid = true;
    } else if (isPaidParam === "false") {
      match.isPaid = false;
    } else if (req.user?.role !== "admin") {
      // Nếu không có param isPaid và không phải admin -> lọc bỏ hóa đơn đã đóng cước
      match.isPaid = { $ne: true };
    }

    // Xử lý assignedUserId - Phân quyền xem hóa đơn đã đóng cước
    // Chỉ áp dụng phân quyền khi isPaid=true
    // LƯU Ý: Khi collectionStatus = "not_collected" (hóa đơn chưa thu), TẤT CẢ user đều có thể thấy
    if (isPaidParam === "true") {
      // Admin + isPaid=true: Xem tất cả hóa đơn đã đóng cước của mọi user (không thêm assignedUserId)
      // User + isPaid=true: Chỉ xem hóa đơn đã đóng cước của chính mình (thêm assignedUserId)
      if (assignedUserId && assignedUserId !== "all") {
        // Nếu có assignedUserId được truyền lên → Lọc theo assignedUserId đó
        if (mongoose.Types.ObjectId.isValid(assignedUserId as string)) {
          match.assignedTo = new mongoose.Types.ObjectId(assignedUserId as string);
        }
      } else if (req.user?.role !== "admin") {
        // Nếu không có assignedUserId và không phải admin → Lọc theo user hiện tại
        if (req.user?._id) {
          match.assignedTo = new mongoose.Types.ObjectId(req.user._id.toString());
        }
      }
    }

    // Xử lý userprovince - Lọc theo tỉnh/thành phố
    // Chỉ lọc theo province khi:
    // 1. userprovince được truyền và hợp lệ (không phải undefined/null/"")
    // 2. VÀ user là admin (admin có thể xem tất cả các tỉnh, nhưng nếu truyền province thì lọc theo)
    const userProvinceStr = typeof userprovince === 'string' ? userprovince.trim() : '';
    if (userProvinceStr && userProvinceStr !== "all" && userProvinceStr !== "") {
      match.province = userProvinceStr;
    }

    // Xử lý tìm kiếm theo mã hóa đơn/mã trạm/tên khách hàng
    // CHỈ KHI CÓ searchInvoiceNumber MỚI thực hiện tìm kiếm
    if (searchInvoiceNumber) {
      const searchStr = String(searchInvoiceNumber).trim(); // Chuyển thành chuỗi và xóa khoảng trắng thừa

      if (searchStr.length < 5 && searchType === "customer") {
        // Nếu từ khóa quá ngắn (< 5 ký tự) và tìm theo mã khách hàng → không tìm kiếm
        match._id = null;
      } else {
        if (searchType === "customer") {
          match.invoiceNumber = { $regex: new RegExp(searchStr + "$", "i") };
        } else {
          const regex = new RegExp(searchStr, "i");

          if (searchType === "station") {
            match.recordBookCode = { $regex: regex };
          } else if (searchType === "customerName") {
            match.customerName = { $regex: regex };
          }
        }
      }
    }
    const dataPipeline: any[] = [
      { $sort: { sortPriority: -1, excelRowIndex: 1, excelOrder: 1, _id: 1 } },
      { $skip: skip },
      { $limit: limitNumber },
      { $lookup: {
          from: "users",
          localField: "assignedTo",
          foreignField: "_id",
          as: "assignedInfo",
          pipeline: [{ $project: { fullName: 1, phone: 1, collectionFee: 1 } }],
        },
      },
      { $unwind: { path: "$assignedInfo", preserveNullAndEmptyArrays: true } },
      { $addFields: { assignedTo: "$assignedInfo" } },
      { $project: { assignedInfo: 0, amountVal: 0 } }
    ];

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
          data: dataPipeline,

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
            { $sort: { collectionDate: -1, excelRowIndex: 1, _id: -1 } },
            { $skip: skip },
            { $limit: limitNumber },
            // Lookup user trực tiếp
            {
              $lookup: {
                from: "users",
                localField: "assignedTo",
                foreignField: "_id",
                as: "assignedInfo",
                pipeline: [{ $project: { fullName: 1, phone: 1, collectionFee: 1 } }],
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
      ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),

      // 2. GROUP (QUAN TRỌNG NHẤT): Xử lý 17k dòng tại đây
      {
        $group: {
          _id: "$assignedTo",
          billing_period: { $first: "$billing_period" },

          paidTotal: {
            $sum: {
              $cond: [
                { $eq: ["$isPaid", true] },
                { $convert: { input: "$totalAmount", to: "double", onError: 0, onNull: 0 } },
                0,
              ],
            },
          },

          collectedTotal: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$collectionStatus", "collected"] },
                    { $ne: ["$isPaid", true] }, // Quan trọng: Chưa đóng cước mới tính là đang giữ
                  ],
                },
                { $convert: { input: "$totalAmount", to: "double", onError: 0, onNull: 0 } },
                0,
              ],
            },
          },

          notCollectedTotal: {
            $sum: {
              $cond: [
                {
                  $and: [{ $eq: ["$collectionStatus", "not_collected"] }, { $ne: ["$isPaid", true] }],
                },
                { $convert: { input: "$totalAmount", to: "double", onError: 0, onNull: 0 } },
                0,
              ],
            },
          },

          paidCount: { $sum: { $cond: [{ $eq: ["$isPaid", true] }, 1, 0] } },
          collectedCount: {
            $sum: {
              $cond: [{ $and: [{ $eq: ["$collectionStatus", "collected"] }, { $ne: ["$isPaid", true] }] }, 1, 0],
            },
          },
          notCollectedCount: {
            $sum: {
              $cond: [{ $and: [{ $eq: ["$collectionStatus", "not_collected"] }, { $ne: ["$isPaid", true] }] }, 1, 0],
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
          paidTotal: 1,
          paidCount: 1,
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
 * GET /api/invoices/daily-summary?days=31
 * Trả về 31 ngày gần nhất (mới nhất đầu danh sách), mỗi ngày gồm số HĐ đã thu, tổng tiền, danh sách người phụ trách.
 */
export const getDailyCollectionSummary = async (req: Request, res: Response) => {
  try {
    const TZ = "Asia/Ho_Chi_Minh";
    const { assignedUserId, dateFrom, dateTo } = req.query;

    // Chế độ khoảng ngày tuỳ chọn vs. N ngày gần nhất
    let startDay: dayjs.Dayjs;
    let endDay: dayjs.Dayjs;

    if (dateFrom && dateTo) {
      // Chế độ từ ngày A → ngày B
      startDay = dayjs.tz(String(dateFrom), "YYYY-MM-DD", TZ).startOf("day");
      endDay = dayjs.tz(String(dateTo), "YYYY-MM-DD", TZ).endOf("day");
      if (!startDay.isValid() || !endDay.isValid() || endDay.isBefore(startDay)) {
        return res.status(400).json({ message: "Khoảng ngày không hợp lệ" });
      }
    } else {
      // Chế độ N ngày gần nhất (mặc định 31)
      const days = Math.max(1, Math.min(parseInt(String(req.query.days || "31"), 10) || 31, 365));
      endDay = dayjs().tz(TZ).endOf("day");
      startDay = endDay.subtract(days - 1, "day").startOf("day");
    }

    const match: any = {
      collectionStatus: "collected",
      collectionDate: { $gte: startDay.toDate(), $lte: endDay.toDate() },
    };

    // Phân quyền
    if (req.user?.role === "user") {
      match.assignedTo = req.user._id;
    } else if (assignedUserId && assignedUserId !== "all") {
      // Admin lọc theo người phụ trách cụ thể
      try {
        match.assignedTo = new mongoose.Types.ObjectId(String(assignedUserId));
      } catch {
        return res.status(400).json({ message: "assignedUserId không hợp lệ" });
      }
    }

    const rows = await Invoice.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: "%d/%m/%Y", date: "$collectionDate", timezone: TZ } },
          totalCount: { $sum: 1 },
          totalAmount: { $sum: { $convert: { input: "$totalAmount", to: "double", onError: 0, onNull: 0 } } },
          assignedIds: { $addToSet: "$assignedTo" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "assignedIds",
          foreignField: "_id",
          as: "users",
          pipeline: [
            { $project: { fullName: 1, email: 1 } },
            { $sort: { _id: 1 } },
          ],
        },
      },
      {
        $project: {
          _id: 0,
          date: "$_id",
          totalCount: 1,
          totalAmount: 1,
          assignedUsers: { $map: { input: "$users", as: "u", in: { $ifNull: ["$$u.fullName", "$$u.email"] } } },
        },
      },
    ]);

    const map = new Map<string, { totalCount: number; totalAmount: number; assignedUsers: string[] }>();
    for (const r of rows) {
      map.set(r.date, { totalCount: r.totalCount || 0, totalAmount: r.totalAmount || 0, assignedUsers: r.assignedUsers || [] });
    }

    // Tạo danh sách ngày liên tiếp từ endDay về startDay
    const totalDays = endDay.diff(startDay, "day") + 1;
    const result: Array<{ date: string; totalCount: number; totalAmount: number; assignedUsers: string[] }> = [];
    for (let i = 0; i < totalDays; i++) {
      const d = endDay.subtract(i, "day").format("DD/MM/YYYY");
      const v = map.get(d);
      result.push({ date: d, totalCount: v?.totalCount ?? 0, totalAmount: v?.totalAmount ?? 0, assignedUsers: v?.assignedUsers ?? [] });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error("Error in getDailyCollectionSummary:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getCollectionSummary = async (req: Request, res: Response) => {
  try {
    const { assignedUserId } = req.query;
    const match: any = {};

    if (assignedUserId && assignedUserId !== "all") {
      if (assignedUserId === "no_one") {
        match.$or = [{ assignedTo: { $exists: false } }, { assignedTo: null }, { assignedTo: "" }];
      } else if (mongoose.Types.ObjectId.isValid(assignedUserId as string)) {
        match.assignedTo = new mongoose.Types.ObjectId(assignedUserId as string);
      }
    }

    const summary = await Invoice.aggregate([
      { $match: match },

      {
        $addFields: {
          amountValue: {
            $let: {
              vars: {
                cleaned: {
                  $trim: {
                    input: {
                      $replaceAll: {
                        input: { $toString: { $ifNull: ["$totalAmount", "0"] } },
                        find: ",",
                        replacement: "",
                      },
                    },
                  },
                },
              },
              in: {
                $cond: [
                  {
                    $or: [{ $eq: ["$$cleaned", ""] }, { $regexMatch: { input: "$$cleaned", regex: /^[^\d.-]+$/ } }],
                  },
                  0,
                  { $toDouble: "$$cleaned" },
                ],
              },
            },
          },
        },
      },

      // Gom nhóm và tính toán 4 chỉ số cùng lúc
      {
        $group: {
          _id: null,

          totalCount: { $sum: 1 },
          totalAmount: { $sum: "$amountValue" },

          collectedCount: {
            $sum: { $cond: [{ $eq: ["$collectionStatus", "collected"] }, 1, 0] },
          },
          collectedAmount: {
            $sum: {
              $cond: [{ $eq: ["$collectionStatus", "collected"] }, "$amountValue", 0],
            },
          },

          notCollectedCount: {
            $sum: {
              $cond: [
                {
                  $and: [{ $eq: ["$collectionStatus", "not_collected"] }, { $ne: ["$isPaid", true] }],
                },
                1,
                0,
              ],
            },
          },
          notCollectedAmount: {
            $sum: {
              $cond: [
                {
                  $and: [{ $eq: ["$collectionStatus", "not_collected"] }, { $ne: ["$isPaid", true] }],
                },
                "$amountValue",
                0,
              ],
            },
          },

          paidCount: {
            $sum: { $cond: [{ $eq: ["$isPaid", true] }, 1, 0] },
          },
          paidAmount: {
            $sum: { $cond: [{ $eq: ["$isPaid", true] }, "$amountValue", 0] },
          },
        },
      },
    ]);

    // Format dữ liệu trả về cho Frontend
    const result = summary[0] || {
      totalCount: 0,
      totalAmount: 0,
      collectedCount: 0,
      collectedAmount: 0,
      notCollectedCount: 0,
      notCollectedAmount: 0,
      paidCount: 0,
      paidAmount: 0,
    };

    res.status(200).json({
      success: true,
      data: {
        total: {
          count: result.totalCount,
          amount: result.totalAmount,
        },
        collected: {
          count: result.collectedCount,
          amount: result.collectedAmount,
        },
        notCollected: {
          count: result.notCollectedCount,
          amount: result.notCollectedAmount,
        },
        isPaid: {
          count: result.paidCount,
          amount: result.paidAmount,
        },
      },
    });
  } catch (error) {
    console.error("getInvoiceSummary error:", error);
    res.status(500).json({ success: false, message: "Lỗi server khi lấy thống kê" });
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

/**
 * Tìm kiếm hóa đơn theo Mã trạm (recordBookCode) - KHÔNG có bộ lọc nào khác.
 * GET /api/invoices/search-by-station?stationCode=...&page=1&limit=20
 */
export const searchInvoicesByStationCode = async (req: Request, res: Response) => {
  try {
    const { stationCode, page = 1, limit = 20 } = req.query;

    // Validate stationCode parameter
    if (!stationCode || typeof stationCode !== "string" || stationCode.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Thiếu tham số stationCode.",
      });
    }

    // Parse pagination parameters
    const pageNumber = parseInt(page as string, 10) || 1;
    const limitNumber = parseInt(limit as string, 10) || 20;
    const skip = (pageNumber - 1) * limitNumber;

    // Create regex pattern for case-insensitive search
    const regex = new RegExp(stationCode as string, "i");

    // Build match query - ONLY search by recordBookCode, no other filters
    const match: any = {
      recordBookCode: regex,
    };

    // Execute aggregation pipeline
    const result = await Invoice.aggregate([
      // Step 1: Filter by station code only
      { $match: match },

      // Step 2: Add numeric field for totalAmount (for sorting)
      {
        $addFields: {
          totalAmountNum: {
            $let: {
              vars: {
                cleaned: {
                  $trim: {
                    input: {
                      $replaceAll: {
                        input: { $toString: { $ifNull: ["$totalAmount", "0"] } },
                        find: ",",
                        replacement: "",
                      },
                    },
                  },
                },
              },
              in: {
                $cond: [
                  {
                    $or: [
                      { $eq: ["$$cleaned", ""] },
                      { $regexMatch: { input: "$$cleaned", regex: /^[^\d.-]+$/ } },
                    ],
                  },
                  0,
                  { $convert: { input: "$$cleaned", to: "double", onError: 0, onNull: 0 } },
                ],
              },
            },
          },
        },
      },

      // Step 3: Facet - split into data and summary
      {
        $facet: {
          // Data stream: get paginated results
          data: [
{ $sort: { excelOrder: 1, _id: 1 } },
            { $skip: skip },
            { $limit: limitNumber },
            // Lookup user information
            {
              $lookup: {
                from: "users",
                localField: "assignedTo",
                foreignField: "_id",
                as: "assignedInfo",
                pipeline: [{ $project: { fullName: 1, phone: 1, collectionFee: 1 } }],
              },
            },
            { $unwind: { path: "$assignedInfo", preserveNullAndEmptyArrays: true } },
            { $addFields: { assignedTo: "$assignedInfo" } },
            { $project: { assignedInfo: 0, totalAmountNum: 0 } },
          ],

          // Summary stream: count total and sum
          summary: [
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
    ]);

    const facetResult = result[0];
    const data = facetResult.data;
    const summaryData = facetResult.summary[0] || {
      totalInvoices: 0,
      sumTotalAmount: 0,
    };

    // Return response
    res.status(200).json({
      success: true,
      data: data,
      summary: {
        totalInvoices: summaryData.totalInvoices,
        totalAmount: summaryData.sumTotalAmount,
      },
      pagination: {
        currentPage: pageNumber,
        invoicesPerPage: limitNumber,
        totalPages: Math.ceil(summaryData.totalInvoices / limitNumber),
      },
    });
  } catch (error) {
    console.error("searchInvoicesByStationCode error:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi tìm kiếm hóa đơn theo mã trạm.",
    });
  }
};

export const fetchAllInvoicesForCopy = async (req: Request, res: Response) => {
  try {
    const { filterPrint, filterCollection, filterAssignedUser, isPaidFilter, selectedProvince } = req.query;

    // console.log(filterPrint, filterCollection, filterAssignedUser, isPaidFilter, selectedProvince);

    const match: any = {};

    if (isPaidFilter === "true") {
      match.isPaid = true;
    } else {
      match.isPaid = { $ne: true };
    }

    if (filterPrint && filterPrint !== "all") {
      match.printStatus = filterPrint === "not_printed" ? { $ne: "printed" } : filterPrint;
    }

    if (filterCollection && filterCollection !== "all") {
      match.collectionStatus = filterCollection;
    }

    if (selectedProvince && selectedProvince !== "all") {
      match.province = selectedProvince;
    }

    if (filterAssignedUser && filterAssignedUser !== "all") {
      if (filterAssignedUser === "no_one") {
        match.$or = [{ assignedTo: { $exists: false } }, { assignedTo: null }, { assignedTo: "" }];
      } else {
        match.assignedTo = filterAssignedUser;
      }
    }

    const result = await Invoice.find(match).select("invoiceNumber -_id").lean();

    res.status(200).json(result);
  } catch (error) {
    console.error("fetchAllInvoicesForCopy Error:", error);
    res.status(500).json({ message: "Lỗi server khi lấy danh sách copy" });
  }
};








