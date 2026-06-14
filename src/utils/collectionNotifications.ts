import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import mongoose from "mongoose";

import { IInvoice } from "../models/invoiceModel";
import User from "../models/userModel";
import { JwtPayload } from "../types/jwtPayload";

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = "Asia/Ho_Chi_Minh";
const FETCH_TIMEOUT_MS = 10_000;

type NotificationInvoice = Partial<IInvoice> & {
  _id?: unknown;
  billing_period?: string | null;
  assignedTo?: unknown;
  collectionDate?: Date | string | null;
};

type NotificationItem = {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  customerAddress: string;
  billingPeriod: string;
  recordBookCode: string;
  currentAmountRaw: string;
  currentAmountValue: number;
  currentAmountDisplay: string;
  previousAmountRaw: string;
  previousAmountValue: number;
  previousAmountDisplay: string;
  totalAmountRaw: string;
  totalAmountValue: number;
  totalAmountDisplay: string;
  collectionDateIso: string;
  collectionDateDisplay: string;
  assignedToId: string;
  assignedToName: string;
};

type NotificationPayload = {
  event: "invoice_collected";
  source: string;
  generatedAt: string;
  count: number;
  actor: {
    userId: string;
    fullName: string;
    username: string;
    role: string;
  };
  items: NotificationItem[];
};

const normalizeId = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === "object" && value !== null) {
    const nestedId = (value as { _id?: unknown })._id;
    if (typeof nestedId === "string") return nestedId;
    if (nestedId instanceof mongoose.Types.ObjectId) return nestedId.toString();
  }
  return "";
};

const normalizeText = (value: unknown): string => String(value || "").trim();

const parseAmountValue = (value: unknown): number => {
  const digits = String(value || "").replace(/[^\d-]/g, "");
  if (!digits) return 0;

  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatAmountValue = (value: number): string => `${value.toLocaleString("vi-VN")} VND`;

const formatCollectionDate = (value: unknown): { iso: string; display: string } => {
  if (!value) return { iso: "", display: "" };

  const normalizedValue =
    value instanceof Date || typeof value === "string" || typeof value === "number" ? value : String(value);
  const parsed = dayjs(normalizedValue);
  if (!parsed.isValid()) return { iso: "", display: "" };

  return {
    iso: parsed.toISOString(),
    display: parsed.tz(TZ).format("HH:mm DD/MM/YYYY"),
  };
};

const getActorInfo = (actor?: JwtPayload | null) => ({
  userId: String(actor?._id || "").trim(),
  fullName: String(actor?.fullName || "").trim(),
  username: String(actor?.username || "").trim(),
  role: String(actor?.role || "").trim(),
});

const getActorDisplayName = (actor: NotificationPayload["actor"]): string =>
  actor.fullName || actor.username || actor.userId || "Khong ro";

const buildWebhookBody = (payload: NotificationPayload) => ({
  ...payload,
  secret: String(process.env.INVOICE_COLLECT_WEBHOOK_SECRET || "").trim(),
});

const buildTelegramMessage = (payload: NotificationPayload): string => {
  const actorName = getActorDisplayName(payload.actor);
  const actorUsername = normalizeText(payload.actor.username);
  const actorRole = normalizeText(payload.actor.role);
  const actorLine = [
    actorName,
    actorUsername ? `@${actorUsername}` : "",
    actorRole ? `(${actorRole})` : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (payload.items.length === 1) {
    const item = payload.items[0];
    return [
      "Thong bao da thu hoa don",
      `Nguoi bam Da thu: ${actorLine || actorName}`,
      item.assignedToName ? `Nguoi phu trach: ${item.assignedToName}` : "",
      `Ma KH: ${item.invoiceNumber || "-"}`,
      item.billingPeriod ? `Ky TT: ${item.billingPeriod}` : "",
      `Ky nay: ${item.currentAmountDisplay}`,
      `Ky truoc: ${item.previousAmountDisplay}`,
      `Tong tien: ${item.totalAmountDisplay}`,
      item.customerName ? `Ten: ${item.customerName}` : "",
      item.customerAddress ? `Dia chi: ${item.customerAddress}` : "",
      item.recordBookCode ? `Tram: ${item.recordBookCode}` : "",
      item.collectionDateDisplay ? `Thoi diem thu: ${item.collectionDateDisplay}` : "",
      payload.source ? `Nguon: ${payload.source}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const previewCodes = payload.items
    .slice(0, 10)
    .map((item) => item.invoiceNumber || item.invoiceId)
    .filter(Boolean)
    .join(", ");
  const remaining = payload.items.length - Math.min(payload.items.length, 10);
  const suffix = remaining > 0 ? `, va ${remaining} hoa don khac` : "";

  return [
    `Thong bao da thu hang loat: ${payload.items.length} hoa don`,
    `Nguoi bam Da thu: ${actorLine || actorName}`,
    `Danh sach: ${previewCodes}${suffix}`,
    payload.source ? `Nguon: ${payload.source}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const sendTelegramNotification = async (payload: NotificationPayload): Promise<void> => {
  const botToken = String(process.env.INVOICE_COLLECT_TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(process.env.INVOICE_COLLECT_TELEGRAM_CHAT_ID || "").trim();
  const threadIdRaw = String(process.env.INVOICE_COLLECT_TELEGRAM_THREAD_ID || "").trim();

  if (!botToken || !chatId) return;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: buildTelegramMessage(payload),
    disable_web_page_preview: true,
  };

  if (/^\d+$/.test(threadIdRaw)) {
    body.message_thread_id = Number(threadIdRaw);
  }

  const response = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram notification failed: ${response.status} ${errorText}`);
  }
};

const sendWebhookNotification = async (payload: NotificationPayload): Promise<void> => {
  const webhookUrl = String(process.env.INVOICE_COLLECT_WEBHOOK_URL || "").trim();
  if (!webhookUrl) return;

  const response = await fetchWithTimeout(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Inbill-Event": "invoice_collected",
      "X-Inbill-Webhook-Secret": String(process.env.INVOICE_COLLECT_WEBHOOK_SECRET || "").trim(),
    },
    body: JSON.stringify(buildWebhookBody(payload)),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Collection webhook failed: ${response.status} ${errorText}`);
  }
};

const resolveAssignedUserMap = async (invoices: NotificationInvoice[]): Promise<Map<string, string>> => {
  const ids = Array.from(
    new Set(
      invoices
        .map((invoice) => normalizeId(invoice.assignedTo))
        .filter((value) => value && mongoose.Types.ObjectId.isValid(value))
    )
  );

  if (ids.length === 0) return new Map<string, string>();

  const users = await User.find({ _id: { $in: ids } })
    .select("fullName username phone")
    .lean();

  return new Map(
    users.map((user) => [
      String(user._id),
      String((user as { fullName?: string; username?: string; phone?: string }).fullName || (user as { username?: string }).username || (user as { phone?: string }).phone || "").trim(),
    ])
  );
};

const buildNotificationItems = async (invoices: NotificationInvoice[]): Promise<NotificationItem[]> => {
  const assignedUserMap = await resolveAssignedUserMap(invoices);

  return invoices.map((invoice) => {
    const invoiceId = normalizeId(invoice._id);
    const assignedToId = normalizeId(invoice.assignedTo);
    const amountValue = parseAmountValue(invoice.totalAmount);
    const dateInfo = formatCollectionDate(invoice.collectionDate);

    return {
      invoiceId,
      invoiceNumber: normalizeText(invoice.invoiceNumber),
      customerName: normalizeText(invoice.customerName),
      customerAddress: normalizeText(invoice.customerAddress),
      billingPeriod: normalizeText(invoice.billing_period),
      recordBookCode: normalizeText(invoice.recordBookCode),
      currentAmountRaw: normalizeText(invoice.currentAmount),
      currentAmountValue: parseAmountValue(invoice.currentAmount),
      currentAmountDisplay: formatAmountValue(parseAmountValue(invoice.currentAmount)),
      previousAmountRaw: normalizeText(invoice.previousAmount),
      previousAmountValue: parseAmountValue(invoice.previousAmount),
      previousAmountDisplay: formatAmountValue(parseAmountValue(invoice.previousAmount)),
      totalAmountRaw: normalizeText(invoice.totalAmount),
      totalAmountValue: amountValue,
      totalAmountDisplay: formatAmountValue(amountValue),
      collectionDateIso: dateInfo.iso,
      collectionDateDisplay: dateInfo.display,
      assignedToId,
      assignedToName: assignedUserMap.get(assignedToId) || "",
    };
  });
};

export const queueCollectedInvoiceNotifications = (
  invoices: NotificationInvoice[],
  actor?: JwtPayload | null,
  source = "unknown"
): void => {
  if (!Array.isArray(invoices) || invoices.length === 0) return;

  const hasTelegramConfig =
    !!String(process.env.INVOICE_COLLECT_TELEGRAM_BOT_TOKEN || "").trim() &&
    !!String(process.env.INVOICE_COLLECT_TELEGRAM_CHAT_ID || "").trim();
  const hasWebhookConfig = !!String(process.env.INVOICE_COLLECT_WEBHOOK_URL || "").trim();

  if (!hasTelegramConfig && !hasWebhookConfig) return;

  void (async () => {
    try {
      const items = await buildNotificationItems(invoices);
      if (items.length === 0) return;

      const payload: NotificationPayload = {
        event: "invoice_collected",
        source,
        generatedAt: new Date().toISOString(),
        count: items.length,
        actor: getActorInfo(actor),
        items,
      };

      const results = await Promise.allSettled([
        sendTelegramNotification(payload),
        sendWebhookNotification(payload),
      ]);

      results.forEach((result) => {
        if (result.status === "rejected") {
          console.error("queueCollectedInvoiceNotifications error:", result.reason);
        }
      });
    } catch (error) {
      console.error("queueCollectedInvoiceNotifications fatal error:", error);
    }
  })();
};

export const didBecomeCollected = (
  beforeStatus: string | null | undefined,
  afterStatus: string | null | undefined
): boolean => beforeStatus !== "collected" && afterStatus === "collected";
