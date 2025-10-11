// src/routes/auth.ts
import express from "express";
import { changepassword, login, me, register } from "../controllers/authController";
import { authenticate } from "../middleware/auth";

const router = express.Router();

router.post("/register", authenticate, register);
router.post("/login", login);
router.post("/changepass", authenticate, changepassword);

// Xác nhận người dùng
router.get("/me", authenticate, me);

export default router;
