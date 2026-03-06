import mongoose from "mongoose";
import { getMongoUri } from "./env";

export const connectDB = async () => {
  await mongoose.connect(getMongoUri());
  console.log("MongoDB connected");
};

