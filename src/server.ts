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
    origin: function (origin, callback) {
      // cho phép các request không có origin (ví dụ từ Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.use(express.json());

app.use("/api/auth", authRoute);
app.use("/api/user", userRoute);
app.use("/api/invoices", invoiceRoute);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
