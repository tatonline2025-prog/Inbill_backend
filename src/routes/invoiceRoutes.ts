import { Router } from "express";
import multer from "multer";
import {
  createInvoice,
  deleteByBillingPeriod,
  deleteInvoice,
  markListInvoicesAsPaid,
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
  getInvoiceSummary,
  getLatestBillingPeriod,
  searchInvoice,
  searchInvoicesByDate,
} from "../controllers/invoice.query.controller";

const router = Router();

// Cấu hình multer để lưu file trong bộ nhớ (memory storage)
// Vì chúng ta chỉ cần đọc rồi bỏ đi, không cần lưu vào đĩa
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Định nghĩa route POST
// - Yêu cầu phải đăng nhập (authenticate)
// - upload.single('excelFile'): Middleware của multer sẽ tìm file có name='excelFile' trong request
router.post(
  "/upload-preview",
  //   authenticate,
  upload.single("excelFile"), // 'excelFile' phải trùng với key trong FormData ở frontend
  previewExcel
);

router.post(
  "/uploadWithProvince",
  //   authenticate,
  upload.single("file"), // 'excelFile' phải trùng với key trong FormData ở frontend
  previewExcelProvince
);

router.get("/summary", getInvoiceSummary);
router.get("/search", authenticate, searchInvoice);

router.get("/fetchall", authenticate, fetchallInvoice);
router.post("/fetchbylist", authenticate, fetchInvoicesByList);
router.get("/forcopy", fetchAllInvoicesForCopy);
router.get("/largest", authenticate, fetchTop20HighestInvoices);
router.get("/top3stations", authenticate, fetchTop3StationsByUser);
router.get("/searchByDate", authenticate, searchInvoicesByDate);
router.get("/fetchallbyuser", authenticate, fetchInvoiceByUser);
router.get("/fetchallbyusermonth", authenticate, fetchInvoiceByUserMonth);
router.get("/fetchalluncolbyuser", authenticate, fetchAllUnColInvoiceByUser);
router.get("/fetchallcolbyuser", authenticate, fetchAllColInvoiceByUser);
router.get("/latest-period", getLatestBillingPeriod);
router.delete("/deleteByBillingPeriod", authenticate, deleteByBillingPeriod);

router.post("/creatnew", authenticate, createInvoice);
router.post("/mark-paid-list", authenticate, authorize(["admin"]), markListInvoicesAsPaid);

// Tìm 1 hoá đơn theo người đảm nhận
// router.get("/fetchUncollectedInvoicesByUser", authenticate, fetchUncollectedInvoicesByUser);
// router.get("/fetchCollectedInvoicesByUser", authenticate, fetchCollectedInvoicesByUser);

router.get("/exportExcel", authenticate, exportInvoicesToExcel);
router.get("/exportExcelPrinted", exportCollectedInvoicesByDate);
router.get("/exportExcelByUser", exportExcelByUser);
router.get("/exportExcelCollected", exportExcelCollected);

router.delete("/delete/:invoiceNumber", authenticate, deleteInvoice);
router.put("/update/:invoiceNumber", authenticate, updateInvoice);
router.patch("/:invoiceId/toggle", authenticate, toggleInvoiceStatus);
router.patch("/:invoiceId/toggleispaid", authenticate, toggleInvoiceIsPaidStatus);

export default router;
