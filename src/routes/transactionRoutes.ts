import express from "express";
import {
  approveTransaction,
  cancelTransaction,
  createBank,
  createTransaction,
  createTransactionType,
  deleteTransaction,
  deleteTransactionByAdmin,
  deleteTransactionType,
  exportAllTransactions,
  getAllCollaborators,
  getAllTransactionsForAdmin,
  getBanks,
  getDailyReport,
  getTransactionTypes,
  getUserTransactions,
  updateBank,
  updateTransaction,
  updateTransactionType,
  // updateTransactionByAdmin,
} from "../controllers/transactionController";
import { authenticate, authorize } from "../middleware/auth";

const router = express.Router();

// Route cho việc tạo Loại GD (Yêu cầu phải là Admin)
router.post("/config/types", authenticate, authorize(["admin"]), createTransactionType);
router.delete("/config/types", authenticate, authorize(["admin"]), deleteTransactionType);
router.put("/config/types", authenticate, authorize(["admin"]), updateTransactionType);
router.get("/config/types", authenticate, getTransactionTypes);

router.post("/config/banks", authenticate, authorize(["admin"]), createBank);
router.put("/config/banks", authenticate, authorize(["admin"]), updateBank);
router.get("/config/banks", authenticate, authorize(["admin"]), getBanks);
router.get("/admin", authenticate, authorize(["admin"]), getAllTransactionsForAdmin);
router.get("/admin/export", authenticate, authorize(["admin"]), exportAllTransactions);
router.get("/admin/collaborators", authenticate, authorize(["admin"]), getAllCollaborators);
router.get("/reports/daily", authenticate, authorize(["admin"]), getDailyReport);

// Route dành cho CTV (user)
router.post("", authenticate, createTransaction);
router.get("", authenticate, getUserTransactions);

// Route có sử dụng biến tuỳ biến
router.put("/admin/:id/approve", authenticate, authorize(["admin"]), approveTransaction);
router.put("/admin/:id/cancel", authenticate, authorize(["admin"]), cancelTransaction);
// router.put("/admin/:id", authenticate, authorize(["admin"]), updateTransactionByAdmin);
router.delete("/admin/:id", authenticate, authorize(["admin"]), deleteTransactionByAdmin);

router.put("/:id", authenticate, updateTransaction);
router.delete("/:id", authenticate, deleteTransaction);

export default router;
