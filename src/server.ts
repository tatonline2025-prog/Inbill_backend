import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import path from "path";

import { connectDB } from "./config/db";

import Invoice from "./models/invoiceModel";
import authRoute from "./routes/authRoute";
import invoiceRouteLayout from "./routes/invoiceLayoutRoute";
import invoiceRoute from "./routes/invoiceRoutes";
import sumRoute from "./routes/sumRoute";
import transactionRoute from "./routes/transactionRoutes";
import userRoute from "./routes/userRoute";

dotenv.config({ path: path.join(__dirname, '..', '.env') });
connectDB().then(async () => {
  // Drop the old unique index if it exists
  try {
    await Invoice.collection.dropIndex("invoiceNumber_1_billing_period_1");
    console.log("✅ Dropped old unique index");
  } catch (err: any) {
    if (err.code === 27) {
      console.log("Index already dropped or not found");
    } else {
      console.error("❌ Error dropping index:", err);
    }
  }
});

const allowedOrigins = [
  "http://localhost:3000", // frontend dev
  "http://localhost:8081", // frontend dev
  "https://inbill.dvtienich.vn", // frontend production
  "https://hoadon.dvtienich.vn", // additional frontend domain
  "https://ctvapi.dvtienich.vn", // additional API domain
  "https://api.dvtienich.vn", // additional API domain
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
    exposedHeaders: ["Content-Disposition"],
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
app.use("/api/transaction", transactionRoute);

app.use("/api/v1/finance", sumRoute);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

// Những hàm chạy 1 lần (chỉ mở khi cần thiết)
// removeInvoice();
// findDuplicateInvoiceNumbers();
// updateAllCollectionFee();
