import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    fullName: { type: String, required: true },
    phone: { type: String, unique: true },
    stt: { type: Number, default: "" },
    bankAccount: { type: String, unique: true },
    bankName: { type: String },
    province: {
      type: String,
      required: false,
      trim: true,
      default: "",
    },
    collectionFee: { type: String },
    usertype: { type: String },
    areaPrefixes: {
      type: [
        {
          area: { type: String, required: true, trim: true },
          prefix: { type: String, required: false, trim: true, default: "" },
        },
      ],
      default: [],
    },
    role: {
      type: String,
      enum: ["admin", "user"],
      default: "user",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model("User", userSchema);
export default User;

export interface IUser {
  _id: string;
  fullName: string;
}
