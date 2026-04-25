import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";
import path from "path";

import Invoice from "./models/invoiceModel";
import authRoute from "./routes/authRoute";
import invoiceRouteLayout from "./routes/invoiceLayoutRoute";
import invoiceRoute from "./routes/invoiceRoutes";
import sumRoute from "./routes/sumRoute";
import transactionRoute from "./routes/transactionRoutes";
import userRoute from "./routes/userRoute";

dotenv.config({ path: path.join(__dirname, "..", ".env") });
const startedAt = new Date();
const appVersion = process.env.APP_VERSION || "1.0.0";

const mapDbState = (state: number): string => {
  switch (state) {
    case 0:
      return "disconnected";
    case 1:
      return "connected";
    case 2:
      return "connecting";
    case 3:
      return "disconnecting";
    default:
      return "unknown";
  }
};

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:8081",
  "https://inbill.dvtienich.vn",
  "https://hoadon.dvtienich.vn",
  "https://ctvapi.dvtienich.vn",
  "https://api.dvtienich.vn",
];

const app = express();

// CORS middleware với cấu hình mạnh hơn
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Cho phép origin nếu có trong danh sách
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (!origin) {
    // Fallback cho request không có origin (như Postman, mobile app)
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Max-Age", "86400");

  // Xử lý preflight request ngay lập tức
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.get("/health", (_req, res) => {
  const dbReadyState = mongoose.connection.readyState;
  const dbState = mapDbState(dbReadyState);
  const isHealthy = dbState === "connected";

  return res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "ok" : "degraded",
    service: "inbill-backend",
    version: appVersion,
    env: process.env.NODE_ENV || "development",
    serverTime: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: startedAt.toISOString(),
    db: {
      state: dbState,
      readyState: dbReadyState,
      host: mongoose.connection.host || "",
      name: mongoose.connection.name || "",
    },
  });
});

app.use("/api/auth", authRoute);
app.use("/api/user", userRoute);
app.use("/api/invoices", invoiceRoute);
app.use("/api/invoiceslayout", invoiceRouteLayout);
app.use("/api/transaction", transactionRoute);
app.use("/api/v1/finance", sumRoute);

export const dropLegacyInvoiceIndex = async () => {
  try {
    await Invoice.collection.dropIndex("invoiceNumber_1_billing_period_1");
    console.log("Dropped legacy invoice index: invoiceNumber_1_billing_period_1");
  } catch (err: unknown) {
    const code = (err as { code?: number } | null)?.code;
    if (code === 27 || code === 26) {
      console.log("Legacy invoice index already missing.");
      return;
    }
    throw err;
  }
};

export default app;
