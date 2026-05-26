export interface JwtPayload {
  _id: string;
  username: string;
  fullName: string;
  usertype: string;
  role: "user" | "admin";
  areaPrefixes?: { area: string; prefix: string }[];
}
