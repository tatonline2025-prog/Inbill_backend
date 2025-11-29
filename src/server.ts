import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { connectDB } from "./config/db";

import userRoute from "./routes/userRoute";
import authRoute from "./routes/authRoute";
import invoiceRoute from "./routes/invoiceRoutes";
import invoiceRouteLayout from "./routes/invoiceLayoutRoute";
import sumRoute from "./routes/sumRoute";
import { findDuplicateInvoiceNumbers, removeInvoice } from "./controllers/invoiceController";
import { updateAllCollectionFee } from "./controllers/userController";

dotenv.config();
connectDB();

const allowedOrigins = [
  "http://localhost:3000", // frontend dev
  "http://localhost:8081", // frontend dev
  "https://inbill.dvtienich.vn", // frontend production
];

const app = express();
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // allow tools / curl
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use("/api/auth", authRoute);
app.use("/api/user", userRoute);
app.use("/api/invoices", invoiceRoute);
app.use("/api/invoiceslayout", invoiceRouteLayout);

app.use("/api/v1/finance", sumRoute);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

// removeInvoice();

// findDuplicateInvoiceNumbers();

// updateAllCollectionFee();
