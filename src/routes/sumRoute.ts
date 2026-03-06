import express from "express";
import { authenticate, authorize } from "../middleware/auth";
import { findOptimalSum } from "../controllers/sumController";

const router = express.Router();

router.post("/optimal-sum", authenticate, authorize(["admin"]), findOptimalSum);

export default router;
