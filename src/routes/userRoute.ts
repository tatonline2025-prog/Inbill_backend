// src/routes/auth.ts
import express from "express";
import { fetchallUser } from "../controllers/userController";

const router = express.Router();

router.get("/fetchall", fetchallUser);

export default router;
