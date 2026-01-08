// src/types/jwtPayload.ts
export interface JwtPayload {
  _id: string;
  username: string;
  fullName: string;
  province: string;
  usertype: string;
  role: "user" | "admin";
}
