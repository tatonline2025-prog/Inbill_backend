// src/routes/auth.ts
import express from "express";
import { getInvoiceLayout, saveInvoiceLayout } from "../controllers/invoiceLayoutController";
import { authenticate } from "../middleware/auth";

const router = express.Router();

router.put("/save", authenticate, saveInvoiceLayout);
router.get("/get", authenticate, getInvoiceLayout);

export default router;
