import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import {
  listCustomerMaster,
  updateCustomerMaster,
  deleteCustomerMaster,
  createInvoiceFromMaster,
  syncCustomerMasterFromInvoices,
} from "../controllers/customerMasterController";

const router = Router();

router.get("/", authenticate, authorize(["admin"]), listCustomerMaster);
router.put("/:id", authenticate, authorize(["admin"]), updateCustomerMaster);
router.delete("/:id", authenticate, authorize(["admin"]), deleteCustomerMaster);
router.post("/:id/create-invoice", authenticate, authorize(["admin"]), createInvoiceFromMaster);
router.post("/sync-from-invoices", authenticate, authorize(["admin"]), syncCustomerMasterFromInvoices);

export default router;
