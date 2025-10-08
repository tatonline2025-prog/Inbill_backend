import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { connectDB } from "./config/db";

import userRoute from "./routes/userRoute";
import authRoute from "./routes/authRoute";
import invoiceRoute from "./routes/invoiceRoutes";

dotenv.config();
connectDB();

const allowedOrigins = [
  "http://localhost:3000", // frontend dev
  "https://inbill.dvtienich.vn", // frontend production
];

const app = express();
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

app.use("/api/auth", authRoute);
app.use("/api/user", userRoute);
app.use("/api/invoices", invoiceRoute);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
