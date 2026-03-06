// src/routes/auth.ts
import express from "express";
import { changeInfo, changeMyInfo, deleteUser, fetchallUser, updateFee } from "../controllers/userController";
import { authenticate, authorize } from "../middleware/auth";

const router = express.Router();

router.get("/fetchall", authenticate, authorize(["admin"]), fetchallUser);

router.put("/changeinfo-self", authenticate, changeMyInfo);
router.put("/changeinfo", authenticate, authorize(["admin"]), changeInfo);
router.delete("/deleteuser/:userId", authenticate, authorize(["admin"]), deleteUser);
router.put("/:userId/update-fee", authenticate, authorize(["admin"]), updateFee);

export default router;
