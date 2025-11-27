import express from "express";
import { changepassword, login, me, register } from "../controllers/authController";
import { authenticate } from "../middleware/auth";
import { findOptimalSum } from "../controllers/sumController";

const router = express.Router();

router.post("/optimal-sum", findOptimalSum);

export default router;
