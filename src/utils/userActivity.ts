import AdminActivity from "../models/adminActivityModel";
import { JwtPayload } from "../types/jwtPayload";
import { getAdminTelegramConfig, processPendingAdminTelegram } from "./adminActivityTelegram";

export const assignedUserId = (value: any): string => String(value?._id ?? value ?? "");
export const ownsRecord = (actor: JwtPayload, record: { assignedTo?: unknown }): boolean =>
  actor.role === "admin" || assignedUserId(record.assignedTo) === String(actor._id);

const fields: Record<string, string> = {
  customerName: "Tên khách hàng", customerAddress: "Địa chỉ", customerPhone: "Số điện thoại",
  recordBookCode: "Mã trạm", billing_period: "Kỳ thanh toán", currentAmount: "Tiền kỳ này",
  previousAmount: "Tiền kỳ trước", totalAmount: "Tổng tiền", note: "Ghi chú", province: "Khu vực",
};
export const activityChanges = (before: any, after: any) => Object.entries(fields).flatMap(([field, label]) => {
  const previous = String(before?.[field] ?? "");
  const next = String(after?.[field] ?? "");
  return previous === next ? [] : [{ field, label, before: previous, after: next }];
});

const titles = {
  invoice_created: "Thêm hóa đơn mới", invoice_updated: "Chỉnh sửa hóa đơn",
  invoices_uploaded: "Tải danh sách Excel", customer_updated: "Cập nhật thông tin khách hàng",
};
export async function recordUserActivity(actor: JwtPayload | undefined, action: keyof typeof titles, data: {
  message: string; entityId?: unknown; customerCode?: string; count?: number;
  changes?: ReturnType<typeof activityChanges>; details?: Record<string, unknown>;
}) {
  if (!actor || actor.role === "admin") return;
  try {
    await AdminActivity.create({ ...data, action, title: titles[action], actorId: actor._id,
      actorName: actor.fullName || actor.username || "User", actorUsername: actor.username || "",
      telegramStatus: getAdminTelegramConfig() ? "pending" : "awaiting_config" });
    void processPendingAdminTelegram();
  } catch (error) {
    console.error("Không ghi được thông báo thao tác user:", error);
  }
}
