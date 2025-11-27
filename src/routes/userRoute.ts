// src/routes/auth.ts
import express from "express";
import { changeInfo, deleteUser, fetchallUser, updateFee } from "../controllers/userController";
import { authenticate } from "../middleware/auth";

const router = express.Router();

router.get("/fetchall", fetchallUser);

router.put("/changeinfo", authenticate, changeInfo);
router.delete("/deleteuser/:userId", authenticate, deleteUser);
router.put("/:userId/update-fee", authenticate, updateFee);

export default router;
