import express from "express";
import { getAllAreaConfigs, createAreaConfig, updateAreaConfig, deleteAreaConfig } from "../controllers/areaConfigController";
import { authenticate, authorize } from "../middleware/auth";

const router = express.Router();

// GET — ai cũng xem được (authenticated)
router.get("/", authenticate, getAllAreaConfigs);

// POST/PUT/DELETE — chỉ admin
router.post("/", authenticate, authorize(["admin"]), createAreaConfig);
router.put("/:id", authenticate, authorize(["admin"]), updateAreaConfig);
router.delete("/:id", authenticate, authorize(["admin"]), deleteAreaConfig);

export default router;
