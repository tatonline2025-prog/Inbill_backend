// src/types/jwtPayload.ts
export interface JwtPayload {
  id: string;
  username: string;
  fullName: string;
  email: string;
  role: "member" | "admin";
}
