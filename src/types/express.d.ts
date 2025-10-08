import { JwtPayload as JwtPayloadType } from "./jwtPayload";

declare module "express-serve-static-core" {
  interface Request {
    user?: JwtPayloadType;
  }
}
