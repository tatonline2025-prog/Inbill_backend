import mongoose from "mongoose";
import AdminActivity from "../models/adminActivityModel";

const MAX_ATTEMPTS = 5;
const TIMEOUT_MS = 10_000;
let running = false;
let worker: ReturnType<typeof setInterval> | undefined;

export function getAdminTelegramConfig() {
  const token = String(process.env.ADMIN_ACTIVITY_TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(process.env.ADMIN_ACTIVITY_TELEGRAM_CHAT_ID || "").trim();
  const topic = String(process.env.ADMIN_ACTIVITY_TELEGRAM_THREAD_ID || "").trim();
  if (!token || !chatId || (topic && (!/^\d+$/.test(topic) || Number(topic) <= 0))) return undefined;
  return { token, chatId, threadId: topic ? Number(topic) : undefined };
}

const line = (value: unknown, limit = 300) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
export function buildAdminTelegramMessage(activity: any): string {
  const time = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "medium", hour12: false })
    .format(new Date(activity.createdAt || Date.now()));
  const parts = ["TAT IN BILL — THÔNG BÁO USER", line(activity.title),
    `Người thao tác: ${line(activity.actorName)}${activity.actorUsername ? ` (${line(activity.actorUsername)})` : ""}`,
    `Thời gian: ${time}`, line(activity.message, 600),
    activity.customerCode ? `Mã KH: ${line(activity.customerCode)}` : "",
    activity.details?.billingPeriod ? `Kỳ: ${line(activity.details.billingPeriod)}` : "",
    activity.details?.fileName ? `File: ${line(activity.details.fileName)}` : "",
    activity.count > 1 ? `Số hóa đơn: ${activity.count}` : "",
    ...(activity.changes || []).map((change: any) => `${line(change.label, 80)}: ${line(change.before) || "(trống)"} → ${line(change.after) || "(trống)"}`),
    activity.details?.totalAmount ? `Tổng tiền: ${line(activity.details.totalAmount)}` : "",
    activity.details?.customerCodes?.length ? `Mã KH trong file: ${activity.details.customerCodes.map((code: unknown) => line(code, 40)).join(", ")}` : "",
  ].filter(Boolean);
  return parts.join("\n").slice(0, 3750) + "\nChi tiết: https://inbill.dvtienich.vn/admin_invoice";
}

export async function deliverAdminTelegramActivity(id: unknown): Promise<void> {
  const config = getAdminTelegramConfig();
  if (!config) return;
  const now = new Date();
  const activity = await AdminActivity.findOneAndUpdate({ _id: id, telegramAttempts: { $lt: MAX_ATTEMPTS },
    telegramStatus: { $in: ["pending", "awaiting_config", "sending"] },
    telegramNextAttemptAt: { $lte: now },
    $or: [{ telegramLockedUntil: null }, { telegramLockedUntil: { $lte: now } }],
  }, { $set: { telegramStatus: "sending", telegramLockedUntil: new Date(Date.now() + 30_000) },
    $inc: { telegramAttempts: 1 } }, { new: true }).lean();
  if (!activity) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let errorCode = "TELEGRAM_NETWORK_ERROR";
  let retryAfterMs = 30_000 * Math.pow(2, Math.max(0, activity.telegramAttempts - 1));
  try {
    const body = { chat_id: config.chatId, text: buildAdminTelegramMessage(activity), disable_web_page_preview: true,
      ...(config.threadId ? { message_thread_id: config.threadId } : {}) };
    const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal,
    });
    const data = await response.json() as { ok?: boolean; error_code?: number; parameters?: { retry_after?: number }; result?: { message_id?: number } };
    if (!response.ok || !data.ok) {
      errorCode = `TELEGRAM_HTTP_${data.error_code || response.status}`;
      if (Number(data.parameters?.retry_after) > 0) retryAfterMs = Math.max(retryAfterMs, Number(data.parameters?.retry_after) * 1000);
      throw new Error(errorCode);
    }
    await AdminActivity.updateOne({ _id: activity._id, telegramStatus: "sending" }, { $set: {
      telegramStatus: "sent", telegramSentAt: new Date(), telegramMessageId: data.result?.message_id ?? null,
      telegramLockedUntil: null, telegramError: "",
    } });
  } catch {
    await AdminActivity.updateOne({ _id: activity._id, telegramStatus: "sending" }, { $set: {
      telegramStatus: activity.telegramAttempts >= MAX_ATTEMPTS ? "failed" : "pending", telegramError: errorCode,
      telegramLockedUntil: null, telegramNextAttemptAt: new Date(Date.now() + retryAfterMs),
    } });
  } finally {
    clearTimeout(timeout);
  }
}

export async function processPendingAdminTelegram(): Promise<void> {
  if (running || !getAdminTelegramConfig() || mongoose.connection.readyState !== 1) return;
  running = true;
  try {
    const now = new Date();
    await AdminActivity.updateMany({ telegramStatus: "sending", telegramAttempts: { $gte: MAX_ATTEMPTS },
      telegramLockedUntil: { $lte: now } }, { $set: { telegramStatus: "failed", telegramLockedUntil: null,
      telegramError: "TELEGRAM_DELIVERY_INTERRUPTED" } });
    const items = await AdminActivity.find({ telegramStatus: { $in: ["awaiting_config", "pending", "sending"] },
      telegramAttempts: { $lt: MAX_ATTEMPTS }, telegramNextAttemptAt: { $lte: now },
      $or: [{ telegramLockedUntil: null }, { telegramLockedUntil: { $lte: now } }],
    }).sort({ createdAt: 1 }).limit(10).select("_id").lean();
    for (let index = 0; index < items.length; index++) {
      await deliverAdminTelegramActivity(items[index]._id);
      if (index < items.length - 1) await new Promise((resolve) => setTimeout(resolve, 3100));
    }
  } catch {
    console.error("Không xử lý được hàng đợi Telegram admin; sẽ thử lại ở lượt sau.");
  } finally {
    running = false;
  }
}

export function startAdminTelegramWorker() {
  if (worker) return;
  worker = setInterval(() => void processPendingAdminTelegram(), 30_000);
  worker.unref();
  mongoose.connection.on("connected", () => void processPendingAdminTelegram());
  void processPendingAdminTelegram();
}
