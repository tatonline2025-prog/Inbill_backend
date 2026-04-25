import type { IncomingMessage, ServerResponse } from "http";
import mongoose from "mongoose";

import app, { dropLegacyInvoiceIndex } from "../src/app";
import { getMongoUri } from "../src/config/env";

// Cache DB connection across serverless invocations (Vercel reuses Lambda containers)
let dbReadyPromise: Promise<typeof mongoose> | null = null;

const ensureDb = async () => {
  if (mongoose.connection.readyState === 1) return;
  if (!dbReadyPromise) {
    dbReadyPromise = mongoose
      .connect(getMongoUri(), { serverSelectionTimeoutMS: 8000 })
      .then(async (m) => {
        try {
          await dropLegacyInvoiceIndex();
        } catch (err) {
          console.error("dropLegacyInvoiceIndex failed:", err);
        }
        return m;
      })
      .catch((err) => {
        dbReadyPromise = null;
        throw err;
      });
  }
  await dbReadyPromise;
};

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await ensureDb();
  } catch (err) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: "error", message: "Database connection failed", detail: String(err) }));
    return;
  }
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
