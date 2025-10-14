// src/routes/auth.ts
import express from "express";
import { changeInfo, deleteUser, fetchallUser } from "../controllers/userController";
import { authenticate } from "../middleware/auth";

const router = express.Router();

router.get("/fetchall", fetchallUser);

router.put("/changeinfo", authenticate, changeInfo);
router.delete("/deleteuser/:userId", authenticate, deleteUser);

export default router;
