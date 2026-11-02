import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { listAdminActivities, markAdminActivitiesRead } from "../controllers/adminActivityController";
const router = Router();
router.use(authenticate, authorize(["admin"]));
router.get("/", listAdminActivities);
router.patch("/:id/read", markAdminActivitiesRead);
export default router;
