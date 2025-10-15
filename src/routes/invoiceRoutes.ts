import { Router } from "express";
import multer from "multer";
import {
  createInvoice,
  exportInvoicesToExcel,
  exportInvoicesToExcelPrinted,
  fetchAllColInvoiceByUser,
  fetchallInvoice,
  fetchAllUnColInvoiceByUser,
  fetchCollectedInvoicesByUser,
  fetchInvoiceByUser,
  fetchInvoiceByUserMonth,
  fetchUncollectedInvoicesByUser,
  previewExcel,
  toggleInvoiceStatus,
} from "../controllers/invoiceController";
import { authenticate, authorize } from "../middleware/auth"; // Import middleware xác thực

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

router.get("/fetchall", fetchallInvoice);
router.get("/fetchallbyuser", authenticate, fetchInvoiceByUser);
router.get("/fetchallbyusermonth", authenticate, fetchInvoiceByUserMonth);
router.get("/fetchalluncolbyuser", authenticate, fetchAllUnColInvoiceByUser);
router.get("/fetchallcolbyuser", authenticate, fetchAllColInvoiceByUser);

router.post("/creatnew", authenticate, createInvoice);

// Tìm 1 hoá đơn theo người đảm nhận
// router.get("/fetchUncollectedInvoicesByUser", authenticate, fetchUncollectedInvoicesByUser);
// router.get("/fetchCollectedInvoicesByUser", authenticate, fetchCollectedInvoicesByUser);

router.get("/exportExcel", exportInvoicesToExcel);
router.get("/exportExcelPrinted", exportInvoicesToExcelPrinted);

router.patch("/:invoiceId/toggle", toggleInvoiceStatus);

export default router;
