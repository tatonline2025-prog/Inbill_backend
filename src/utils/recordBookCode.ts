export const normalizeRecordBookCode = (value: unknown): string => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (/^\d+$/.test(normalized)) {
    return normalized.padStart(9, "0");
  }
  return normalized;
};
