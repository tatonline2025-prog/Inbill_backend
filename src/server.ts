import dotenv from "dotenv";
import path from "path";

import app, { dropLegacyInvoiceIndex } from "./app";
import { connectDB } from "./config/db";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const start = async () => {
  try {
    await connectDB();
    await dropLegacyInvoiceIndex();
    const PORT = Number(process.env.PORT || 5000);
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Startup failed:", error);
    process.exit(1);
  }
};

void start();
