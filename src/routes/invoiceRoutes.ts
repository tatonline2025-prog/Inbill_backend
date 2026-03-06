import { Router } from "express";
import multer from "multer";
import {
  createInvoice,
  deleteByBillingPeriod,
  deleteInvoice,
  markListInvoicesAsPaid,
  quickAddInvoice,
  toggleInvoiceIsPaidStatus,
  toggleInvoiceStatus,
  updateInvoice,
} from "../controllers/invoiceController";
import { authenticate, authorize } from "../middleware/auth"; // Import middleware xác thực
import {
  exportCollectedInvoicesByDate,
  exportExcelByUser,
  exportExcelCollected,
  exportInvoicesToExcel,
  previewExcel,
  previewExcelProvince,
} from "../controllers/invoice.excel.controller";
import {
  fetchAllColInvoiceByUser,
  fetchallInvoice,
  fetchAllInvoicesForCopy,
  fetchAllUnColInvoiceByUser,
  fetchInvoiceByUser,
  fetchInvoiceByUserMonth,
  fetchInvoicesByList,
  fetchTop20HighestInvoices,
  fetchTop3StationsByUser,
  fetchUserInvoices,
  getCollectionSummary,
  getInvoiceSummary,
  getLatestBillingPeriod,
  searchInvoice,
  searchInvoicesByDate,
  searchInvoicesByStationCode,
} from "../controllers/invoice.query.controller";

const router = Router();

// Cấu hình multer để lưu file trong bộ nhớ (memory storage)
// Vì chúng ta chỉ cần đọc rồi bỏ đi, không cần lưu vào đĩa
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Định nghĩa route POST
// - Yêu cầu phải đăng nhập (authenticate)
// - upload.fields: Middleware của multer sẽ parse cả file và text fields
router.post(
  "/upload-preview",
  authenticate,
  authorize(["admin"]),
  upload.fields([
    { name: "excelFile", maxCount: 1 },
    { name: "userId", maxCount: 1 },
    { name: "billing_period", maxCount: 1 },
  ]),
  previewExcel
);

router.post(
  "/uploadWithProvince",
  authenticate,
  authorize(["admin"]),
  upload.single("excelFile"), // 'excelFile' phải trùng với key trong FormData ở frontend
  previewExcelProvince
);

router.get("/summary", authenticate, getInvoiceSummary);
router.get("/collectsummary", authenticate, getCollectionSummary);
router.get("/search", authenticate, searchInvoice);
router.get("/search-by-station", authenticate, searchInvoicesByStationCode);

router.get("/fetchall", authenticate, fetchallInvoice);
router.get("/fetchuserinvoices", authenticate, fetchUserInvoices);
router.post("/fetchbylist", authenticate, fetchInvoicesByList);
router.get("/forcopy", authenticate, authorize(["admin"]), fetchAllInvoicesForCopy);
router.get("/largest", authenticate, fetchTop20HighestInvoices);
router.get("/top3stations", authenticate, fetchTop3StationsByUser);
router.get("/searchByDate", authenticate, searchInvoicesByDate);
router.get("/fetchallbyuser", authenticate, fetchInvoiceByUser);
router.get("/fetchallbyusermonth", authenticate, fetchInvoiceByUserMonth);
router.get("/fetchalluncolbyuser", authenticate, fetchAllUnColInvoiceByUser);
router.get("/fetchallcolbyuser", authenticate, fetchAllColInvoiceByUser);
router.get("/latest-period", authenticate, getLatestBillingPeriod);
router.delete("/deleteByBillingPeriod", authenticate, deleteByBillingPeriod);

router.post("/creatnew", authenticate, createInvoice);
router.post("/quick-add", authenticate, quickAddInvoice);
router.post("/mark-paid-list", authenticate, authorize(["admin"]), markListInvoicesAsPaid);

// Tìm 1 hoá đơn theo người đảm nhận
// router.get("/fetchUncollectedInvoicesByUser", authenticate, fetchUncollectedInvoicesByUser);
// router.get("/fetchCollectedInvoicesByUser", authenticate, fetchCollectedInvoicesByUser);

router.get("/exportExcel", authenticate, exportInvoicesToExcel);
router.get("/exportExcelPrinted", authenticate, authorize(["admin"]), exportCollectedInvoicesByDate);
router.get("/exportExcelByUser", authenticate, authorize(["admin"]), exportExcelByUser);
router.get("/exportExcelCollected", authenticate, authorize(["admin"]), exportExcelCollected);

router.delete("/delete/:invoiceNumber", authenticate, deleteInvoice);
router.put("/update/:invoiceNumber", authenticate, updateInvoice);
router.patch("/:invoiceId/toggle", authenticate, toggleInvoiceStatus);
router.patch("/:invoiceId/toggleispaid", authenticate, toggleInvoiceIsPaidStatus);

export default router;
