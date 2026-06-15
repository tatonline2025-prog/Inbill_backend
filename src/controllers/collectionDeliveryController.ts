import { Request, Response } from "express";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import mongoose from "mongoose";

import CollectionDeliveryLog from "../models/collectionDeliveryLogModel";
import Invoice from "../models/invoiceModel";
import {
  buildCollectedNotificationEventKey,
  sendCollectedInvoiceNotifications,
} from "../utils/collectionNotifications";

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = "Asia/Ho_Chi_Minh";

const buildDateRange = (date: string) => {
  const startOfDay = dayjs.tz(date, "YYYY-MM-DD", TZ).startOf("day");
  const endOfDay = startOfDay.endOf("day");
  return { startOfDay, endOfDay };
};

const parseReplayChannel = (value: unknown): Array<"telegram" | "webhook"> => {
  const normalized = String(value || "both").trim().toLowerCase();
  if (normalized === "telegram") return ["telegram"];
  if (normalized === "webhook") return ["webhook"];
  return ["telegram", "webhook"];
};

export const getCollectionDeliverySummary = async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Chỉ admin được phép xem đối soát đã thu." });
    }

    const date = String(req.query.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: "Ngày không hợp lệ (YYYY-MM-DD)." });
    }

    const assignedUserId = String(req.query.assignedUserId || "all").trim();
    const { startOfDay, endOfDay } = buildDateRange(date);
    const match: Record<string, unknown> = {
      collectionStatus: "collected",
      collectionDate: { $gte: startOfDay.toDate(), $lte: endOfDay.toDate() },
    };

    if (assignedUserId !== "all") {
      if (!mongoose.Types.ObjectId.isValid(assignedUserId)) {
        return res.status(400).json({ message: "assignedUserId không hợp lệ." });
      }
      match.assignedTo = new mongoose.Types.ObjectId(assignedUserId);
    }

    const invoices = await Invoice.find(match)
      .select(
        "_id invoiceNumber billing_period assignedTo customerName recordBookCode totalAmount collectionDate collectionStatus"
      )
      .populate("assignedTo", "fullName username phone")
      .sort({ collectionDate: 1, _id: 1 })
      .lean();

    const eventKeys = invoices.map((invoice) => buildCollectedNotificationEventKey(invoice));
    const logs = await CollectionDeliveryLog.find({ eventKey: { $in: eventKeys } })
      .select(
        "eventKey telegramStatus telegramSentAt telegramError webhookStatus webhookSentAt webhookError collectionDateDisplay"
      )
      .lean();
    const logMap = new Map(logs.map((log) => [String(log.eventKey), log]));

    const items = invoices.map((invoice) => {
      const assignedUser = invoice.assignedTo as { fullName?: string; username?: string; phone?: string } | null;
      const eventKey = buildCollectedNotificationEventKey(invoice);
      const log = logMap.get(eventKey);
      const collectionDateDisplay = invoice.collectionDate
        ? dayjs(invoice.collectionDate).tz(TZ).format("HH:mm DD/MM/YYYY")
        : "";

      return {
        eventKey,
        invoiceId: String(invoice._id),
        invoiceNumber: invoice.invoiceNumber || "",
        billingPeriod: invoice.billing_period || "",
        assignedToName: assignedUser?.fullName || assignedUser?.username || assignedUser?.phone || "",
        customerName: invoice.customerName || "",
        recordBookCode: invoice.recordBookCode || "",
        totalAmount: Number(String(invoice.totalAmount || "0").replace(/[^\d-]/g, "")) || 0,
        collectionDateDisplay,
        telegramStatus: String(log?.telegramStatus || "pending"),
        telegramSentAt: log?.telegramSentAt || null,
        telegramError: String(log?.telegramError || ""),
        webhookStatus: String(log?.webhookStatus || "pending"),
        webhookSentAt: log?.webhookSentAt || null,
        webhookError: String(log?.webhookError || ""),
      };
    });

    const summary = {
      date,
      totalCollectedCount: items.length,
      telegramDeliveredCount: items.filter((item) => item.telegramStatus === "sent").length,
      webhookDeliveredCount: items.filter((item) => item.webhookStatus === "sent").length,
      missingTelegramCount: items.filter((item) => item.telegramStatus !== "sent").length,
      missingWebhookCount: items.filter((item) => item.webhookStatus !== "sent").length,
    };

    return res.status(200).json({
      success: true,
      summary,
      items,
    });
  } catch (error) {
    console.error("getCollectionDeliverySummary error:", error);
    return res.status(500).json({ message: "Lỗi server khi lấy đối soát đã thu." });
  }
};

export const replayCollectionDelivery = async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Chỉ admin được phép bổ sung đã thu." });
    }

    const {
      date,
      assignedUserId = "all",
      channel = "both",
      mode = "missing",
      invoiceIds = [],
    } = (req.body || {}) as {
      date?: string;
      assignedUserId?: string;
      channel?: string;
      mode?: "missing" | "force";
      invoiceIds?: string[];
    };

    const normalizedDate = String(date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      return res.status(400).json({ message: "Ngày không hợp lệ (YYYY-MM-DD)." });
    }

    const channels = parseReplayChannel(channel);
    const force = mode === "force";
    const normalizedAssignedUserId = String(assignedUserId || "all").trim();

    const { startOfDay, endOfDay } = buildDateRange(normalizedDate);
    const match: Record<string, unknown> = {
      collectionStatus: "collected",
      collectionDate: { $gte: startOfDay.toDate(), $lte: endOfDay.toDate() },
    };

    if (normalizedAssignedUserId !== "all") {
      if (!mongoose.Types.ObjectId.isValid(normalizedAssignedUserId)) {
        return res.status(400).json({ message: "assignedUserId không hợp lệ." });
      }
      match.assignedTo = new mongoose.Types.ObjectId(normalizedAssignedUserId);
    }

    const normalizedInvoiceIds = Array.isArray(invoiceIds)
      ? invoiceIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    if (normalizedInvoiceIds.length > 0) {
      match._id = {
        $in: normalizedInvoiceIds.filter((value) => mongoose.Types.ObjectId.isValid(value)).map((value) => new mongoose.Types.ObjectId(value)),
      };
    }

    const invoices = await Invoice.find(match).lean();
    if (invoices.length === 0) {
      return res.status(404).json({ message: "Không tìm thấy hóa đơn đã thu phù hợp để bổ sung." });
    }

    await sendCollectedInvoiceNotifications(invoices, req.user, "admin_replay_collection_delivery", {
      channels,
      force,
    });

    return res.status(200).json({
      success: true,
      message: "Đã gửi yêu cầu bổ sung.",
      replayedCount: invoices.length,
      channel,
      mode,
    });
  } catch (error) {
    console.error("replayCollectionDelivery error:", error);
    return res.status(500).json({ message: "Lỗi server khi bổ sung đã thu." });
  }
};
