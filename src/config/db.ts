import mongoose from "mongoose";
import { getMongoUri } from "./env";

const DB_NAME = "Bill_hoa_don";

export const connectDB = async () => {
  await mongoose.connect(getMongoUri(), { dbName: DB_NAME });
  console.log(`MongoDB connected — db: ${DB_NAME}`);
};

