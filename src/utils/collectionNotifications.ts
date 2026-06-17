import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import mongoose from "mongoose";

import CollectionDeliveryLog from "../models/collectionDeliveryLogModel";
import { IInvoice } from "../models/invoiceModel";
import User from "../models/userModel";
import { JwtPayload } from "../types/jwtPayload";

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = "Asia/Ho_Chi_Minh";
const FETCH_TIMEOUT_MS = 10_000;
const DELIVERY_LOCK_WINDOW_MS = 60_000;

type NotificationChannel = "telegram" | "webhook";

type NotificationActor = {
  userId: string;
  fullName: string;
  username: string;
  role: string;
};

type NotificationInvoice = Partial<IInvoice> & {
  _id?: unknown;
  billing_period?: string | null;
  assignedTo?: unknown;
  collectionDate?: Date | string | null;
};

type NotificationItem = {
  eventKey: string;
  sheetRowKey: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  name: string;
  customerAddress: string;
  address: string;
  billingPeriod: string;
  billing_period: string;
  recordBookCode: string;
  stationCode: string;
  currentAmountRaw: string;
  currentAmountValue: number;
  currentAmountDisplay: string;
  currentAmount: string;
  previousAmountRaw: string;
  previousAmountValue: number;
  previousAmountDisplay: string;
  previousAmount: string;
  totalAmountRaw: string;
  totalAmountValue: number;
  totalAmountDisplay: string;
  totalAmount: string;
  collectionDateIso: string;
  collectionDateDisplay: string;
  assignedToId: string;
  assignedToName: string;
  assignedName: string;
};

type NotificationPayload = {
  event: "invoice_collected";
  source: string;
  generatedAt: string;
  count: number;
  actor: NotificationActor;
  items: NotificationItem[];
};

export type SendCollectedNotificationOptions = {
  channels?: NotificationChannel[];
  force?: boolean;
};

const normalizeId = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === "object" && value !== null) {
    const nestedId = (value as { _id?: unknown })._id;
    if (typeof nestedId === "string") return nestedId.trim();
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

const toObjectIdOrNull = (value: string): mongoose.Types.ObjectId | null =>
  mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;

const truncateErrorMessage = (value: unknown, limit = 500): string => {
  const normalized =
    value instanceof Error
      ? value.message
      : typeof value === "string"
      ? value
      : JSON.stringify(value || "Unknown error");

  return normalized.slice(0, limit);
};

const getActorInfo = (actor?: JwtPayload | null): NotificationActor => ({
  userId: String(actor?._id || "").trim(),
  fullName: String(actor?.fullName || "").trim(),
  username: String(actor?.username || "").trim(),
  role: String(actor?.role || "").trim(),
});

const getActorDisplayName = (actor: NotificationActor): string =>
  actor.fullName || actor.username || actor.userId || "Khong ro";

export const buildCollectedNotificationEventKey = (invoice: {
  _id?: unknown;
  invoiceNumber?: string | null;
  collectionDate?: Date | string | null;
}): string => {
  const invoiceId = normalizeId(invoice._id);
  const invoiceNumber = normalizeText(invoice.invoiceNumber);
  const collectionMinute = dayjs(invoice.collectionDate || new Date())
    .tz(TZ)
    .format("YYYY-MM-DDTHH:mm");

  return `${invoiceId || invoiceNumber}:${collectionMinute}`;
};

const buildWebhookBody = (payload: NotificationPayload) => ({
  ...payload,
  secret: String(process.env.INVOICE_COLLECT_WEBHOOK_SECRET || "").trim(),
});

const buildTelegramMessage = (item: NotificationItem, actor: NotificationActor): string => {
  const assignedName = normalizeText(item.assignedToName) || getActorDisplayName(actor);
  const invoiceCode = normalizeText(item.invoiceNumber || item.invoiceId) || "-";

  return [
    "Thong bao da thu hoa don",
    `Ma KH: ${invoiceCode}`,
    `Nguoi phu trach: ${assignedName || "Khong ro"}`,
    item.collectionDateDisplay ? `Thoi diem thu: ${item.collectionDateDisplay}` : "",
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

const sendTelegramNotification = async (item: NotificationItem, actor: NotificationActor): Promise<void> => {
  const botToken = String(process.env.INVOICE_COLLECT_TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(process.env.INVOICE_COLLECT_TELEGRAM_CHAT_ID || "").trim();
  const threadIdRaw = String(process.env.INVOICE_COLLECT_TELEGRAM_THREAD_ID || "").trim();

  if (!botToken || !chatId) return;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: buildTelegramMessage(item, actor),
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
      String(
        (user as { fullName?: string; username?: string; phone?: string }).fullName ||
          (user as { username?: string }).username ||
          (user as { phone?: string }).phone ||
          ""
      ).trim(),
    ])
  );
};

const buildNotificationItems = async (invoices: NotificationInvoice[]): Promise<NotificationItem[]> => {
  const assignedUserMap = await resolveAssignedUserMap(invoices);

  return invoices.map((invoice) => {
    const invoiceId = normalizeId(invoice._id);
    const assignedToId = normalizeId(invoice.assignedTo);
    const currentAmountValue = parseAmountValue(invoice.currentAmount);
    const previousAmountValue = parseAmountValue(invoice.previousAmount);
    const totalAmountValue = parseAmountValue(invoice.totalAmount);
    const dateInfo = formatCollectionDate(invoice.collectionDate);

    return {
      eventKey: buildCollectedNotificationEventKey(invoice),
      sheetRowKey: invoiceId || normalizeText(invoice.invoiceNumber),
      invoiceId,
      invoiceNumber: normalizeText(invoice.invoiceNumber),
      customerName: normalizeText(invoice.customerName),
      name: normalizeText(invoice.customerName),
      customerAddress: normalizeText(invoice.customerAddress),
      address: normalizeText(invoice.customerAddress),
      billingPeriod: normalizeText(invoice.billing_period),
      billing_period: normalizeText(invoice.billing_period),
      recordBookCode: normalizeText(invoice.recordBookCode),
      stationCode: normalizeText(invoice.recordBookCode),
      currentAmountRaw: normalizeText(invoice.currentAmount),
      currentAmountValue,
      currentAmountDisplay: formatAmountValue(currentAmountValue),
      currentAmount: String(currentAmountValue),
      previousAmountRaw: normalizeText(invoice.previousAmount),
      previousAmountValue,
      previousAmountDisplay: formatAmountValue(previousAmountValue),
      previousAmount: String(previousAmountValue),
      totalAmountRaw: normalizeText(invoice.totalAmount),
      totalAmountValue,
      totalAmountDisplay: formatAmountValue(totalAmountValue),
      totalAmount: String(totalAmountValue),
      collectionDateIso: dateInfo.iso,
      collectionDateDisplay: dateInfo.display,
      assignedToId,
      assignedToName: assignedUserMap.get(assignedToId) || "",
      assignedName: assignedUserMap.get(assignedToId) || "",
    };
  });
};

const uniqueItemsByEventKey = (items: NotificationItem[]): NotificationItem[] => {
  const map = new Map<string, NotificationItem>();
  items.forEach((item) => {
    if (!map.has(item.eventKey)) {
      map.set(item.eventKey, item);
    }
  });

  return Array.from(map.values());
};

const buildLogMetadata = (
  item: NotificationItem,
  actor: NotificationActor,
  source: string
): Record<string, unknown> => ({
  invoiceId: toObjectIdOrNull(item.invoiceId),
  invoiceNumber: item.invoiceNumber,
  billingPeriod: item.billingPeriod,
  assignedTo: toObjectIdOrNull(item.assignedToId),
  assignedToName: item.assignedToName,
  collectionDate: item.collectionDateIso ? new Date(item.collectionDateIso) : null,
  collectionDateDisplay: item.collectionDateDisplay,
  totalAmountValue: item.totalAmountValue,
  source,
  actor,
});

const ensureDeliveryLogs = async (
  items: NotificationItem[],
  actor: NotificationActor,
  source: string
): Promise<void> => {
  if (items.length === 0) return;

  try {
    await CollectionDeliveryLog.bulkWrite(
      items.map((item) => ({
        updateOne: {
          filter: { eventKey: item.eventKey },
          update: {
            $setOnInsert: {
              eventKey: item.eventKey,
              telegramStatus: "pending",
              webhookStatus: "pending",
            },
            $set: buildLogMetadata(item, actor, source),
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  } catch (error) {
    const maybeCode = (error as { code?: number }).code;
    if (maybeCode !== 11000) {
      throw error;
    }
  }
};

const claimDeliveryChannel = async (
  item: NotificationItem,
  actor: NotificationActor,
  source: string,
  channel: NotificationChannel,
  force: boolean
): Promise<boolean> => {
  const statusField = channel === "telegram" ? "telegramStatus" : "webhookStatus";
  const lockField = channel === "telegram" ? "telegramLockExpiresAt" : "webhookLockExpiresAt";
  const errorField = channel === "telegram" ? "telegramError" : "webhookError";
  const now = new Date();
  const lockExpiresAt = new Date(now.getTime() + DELIVERY_LOCK_WINDOW_MS);

  const filter: Record<string, unknown> = {
    eventKey: item.eventKey,
    $or: [
      { [lockField]: null },
      { [lockField]: { $exists: false } },
      { [lockField]: { $lt: now } },
    ],
  };

  if (!force) {
    filter[statusField] = { $ne: "sent" };
  }

  const update: Record<string, unknown> = {
    $set: {
      ...buildLogMetadata(item, actor, source),
      [statusField]: "sending",
      [lockField]: lockExpiresAt,
      [errorField]: "",
      lastAttemptAt: now,
    },
  };

  const claimed = await CollectionDeliveryLog.findOneAndUpdate(filter, update, {
    new: true,
  })
    .select("_id")
    .lean();

  return !!claimed;
};

const markChannelSuccess = async (
  channel: NotificationChannel,
  items: NotificationItem[],
  actor: NotificationActor,
  source: string
): Promise<void> => {
  if (items.length === 0) return;

  const statusField = channel === "telegram" ? "telegramStatus" : "webhookStatus";
  const sentAtField = channel === "telegram" ? "telegramSentAt" : "webhookSentAt";
  const errorField = channel === "telegram" ? "telegramError" : "webhookError";
  const lockField = channel === "telegram" ? "telegramLockExpiresAt" : "webhookLockExpiresAt";
  const sentAt = new Date();

  await Promise.all(
    items.map((item) =>
      CollectionDeliveryLog.updateOne(
        { eventKey: item.eventKey },
        {
          $set: {
            ...buildLogMetadata(item, actor, source),
            [statusField]: "sent",
            [sentAtField]: sentAt,
            [errorField]: "",
            [lockField]: null,
          },
        }
      )
    )
  );
};

const markChannelFailed = async (
  channel: NotificationChannel,
  items: NotificationItem[],
  actor: NotificationActor,
  source: string,
  error: unknown
): Promise<void> => {
  if (items.length === 0) return;

  const statusField = channel === "telegram" ? "telegramStatus" : "webhookStatus";
  const errorField = channel === "telegram" ? "telegramError" : "webhookError";
  const lockField = channel === "telegram" ? "telegramLockExpiresAt" : "webhookLockExpiresAt";
  const errorMessage = truncateErrorMessage(error);

  await Promise.all(
    items.map((item) =>
      CollectionDeliveryLog.updateOne(
        { eventKey: item.eventKey },
        {
          $set: {
            ...buildLogMetadata(item, actor, source),
            [statusField]: "failed",
            [errorField]: errorMessage,
            [lockField]: null,
          },
        }
      )
    )
  );
};

const deliverTelegramNotifications = async (
  items: NotificationItem[],
  actor: NotificationActor,
  source: string,
  force: boolean
): Promise<void> => {
  const claimedItems = (
    await Promise.all(
      items.map(async (item) => ((await claimDeliveryChannel(item, actor, source, "telegram", force)) ? item : null))
    )
  ).filter((item): item is NotificationItem => !!item);

  if (claimedItems.length === 0) return;

  const results = await Promise.allSettled(
    claimedItems.map(async (item) => {
      try {
        await sendTelegramNotification(item, actor);
        await markChannelSuccess("telegram", [item], actor, source);
      } catch (error) {
        await markChannelFailed("telegram", [item], actor, source, error);
        throw error;
      }
    })
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const invoiceCode = claimedItems[index]?.invoiceNumber || claimedItems[index]?.invoiceId || "unknown";
      console.error("[collection-notify] telegram_error", source, invoiceCode, result.reason);
    }
  });
};

const deliverWebhookNotifications = async (
  items: NotificationItem[],
  actor: NotificationActor,
  source: string,
  force: boolean
): Promise<void> => {
  const claimedItems = (
    await Promise.all(
      items.map(async (item) => ((await claimDeliveryChannel(item, actor, source, "webhook", force)) ? item : null))
    )
  ).filter((item): item is NotificationItem => !!item);

  if (claimedItems.length === 0) return;

  const payload: NotificationPayload = {
    event: "invoice_collected",
    source,
    generatedAt: new Date().toISOString(),
    count: claimedItems.length,
    actor,
    items: claimedItems,
  };

  try {
    await sendWebhookNotification(payload);
    await markChannelSuccess("webhook", claimedItems, actor, source);
  } catch (error) {
    await markChannelFailed("webhook", claimedItems, actor, source, error);
    console.error("[collection-notify] webhook_error", source, error);
  }
};

const normalizeChannels = (channels?: NotificationChannel[]): NotificationChannel[] => {
  const requested = Array.isArray(channels) && channels.length > 0 ? channels : ["telegram", "webhook"];
  return Array.from(new Set(requested.filter((value): value is NotificationChannel => value === "telegram" || value === "webhook")));
};

export const sendCollectedInvoiceNotifications = async (
  invoices: NotificationInvoice[],
  actor?: JwtPayload | null,
  source = "unknown",
  options: SendCollectedNotificationOptions = {}
): Promise<void> => {
  if (!Array.isArray(invoices) || invoices.length === 0) return;

  const requestedChannels = normalizeChannels(options.channels);
  const hasTelegramConfig =
    !!String(process.env.INVOICE_COLLECT_TELEGRAM_BOT_TOKEN || "").trim() &&
    !!String(process.env.INVOICE_COLLECT_TELEGRAM_CHAT_ID || "").trim();
  const hasWebhookConfig = !!String(process.env.INVOICE_COLLECT_WEBHOOK_URL || "").trim();

  const activeChannels = requestedChannels.filter((channel) =>
    channel === "telegram" ? hasTelegramConfig : hasWebhookConfig
  );
  if (activeChannels.length === 0) return;

  const actorInfo = getActorInfo(actor);

  try {
    const items = uniqueItemsByEventKey(await buildNotificationItems(invoices));
    if (items.length === 0) {
      console.info("[collection-notify] skip_no_items", source);
      return;
    }

    await ensureDeliveryLogs(items, actorInfo, source);

    console.info(
      "[collection-notify] start",
      JSON.stringify({
        source,
        count: items.length,
        channels: activeChannels,
        force: !!options.force,
        invoiceNumbers: items.slice(0, 10).map((item) => item.invoiceNumber || item.invoiceId),
      })
    );

    if (activeChannels.includes("telegram")) {
      await deliverTelegramNotifications(items, actorInfo, source, !!options.force);
    }

    if (activeChannels.includes("webhook")) {
      await deliverWebhookNotifications(items, actorInfo, source, !!options.force);
    }
  } catch (error) {
    console.error("[collection-notify] fatal", source, error);
  }
};

export const queueCollectedInvoiceNotifications = (
  invoices: NotificationInvoice[],
  actor?: JwtPayload | null,
  source = "unknown",
  options: SendCollectedNotificationOptions = {}
): void => {
  const task = () => {
    void sendCollectedInvoiceNotifications(invoices, actor, source, options);
  };

  if (typeof setImmediate === "function") {
    setImmediate(task);
    return;
  }

  void Promise.resolve().then(task);
};

export const didBecomeCollected = (
  beforeStatus: string | null | undefined,
  afterStatus: string | null | undefined
): boolean => beforeStatus !== "collected" && afterStatus === "collected";
