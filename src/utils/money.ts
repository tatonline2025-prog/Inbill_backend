export const normalizeMoneyString = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "0";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "0";
    return Math.max(0, Math.trunc(value)).toString();
  }

  const digits = String(value).trim().replace(/[^\d]/g, "");
  return digits || "0";
};

export const parseMoneyNumber = (value: unknown): number => {
  const normalized = normalizeMoneyString(value);
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const hasMoneyValue = (value: unknown): boolean => {
  return value !== null && value !== undefined && String(value).trim() !== "";
};

export const resolveInvoiceAmounts = (input: {
  currentAmount?: unknown;
  previousAmount?: unknown;
  totalAmount?: unknown;
}) => {
  const hasCurrent = hasMoneyValue(input.currentAmount);
  const hasPrevious = hasMoneyValue(input.previousAmount);
  const hasTotal = hasMoneyValue(input.totalAmount);

  const previousAmountNum = hasPrevious ? parseMoneyNumber(input.previousAmount) : 0;

  let currentAmountNum: number;
  let totalAmountNum: number;

  if (hasTotal) {
    const requestedTotal = parseMoneyNumber(input.totalAmount);
    currentAmountNum = Math.max(0, requestedTotal - previousAmountNum);
    totalAmountNum = currentAmountNum + previousAmountNum;
  } else {
    currentAmountNum = hasCurrent ? parseMoneyNumber(input.currentAmount) : 0;
    totalAmountNum = currentAmountNum + previousAmountNum;
  }

  return {
    hasAnyAmount: hasCurrent || hasPrevious || hasTotal,
    currentAmountNum,
    previousAmountNum,
    totalAmountNum,
    currentAmount: normalizeMoneyString(currentAmountNum),
    previousAmount: normalizeMoneyString(previousAmountNum),
    totalAmount: normalizeMoneyString(totalAmountNum),
  };
};
