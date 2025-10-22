// src/types/jwtPayload.ts
export interface JwtPayload {
  _id: string;
  username: string;
  fullName: string;
  email: string;
  province: string;
  role: "member" | "admin";
}
