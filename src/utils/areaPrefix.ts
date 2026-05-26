export const FREE_AREA_NAME = "Tự do";

export interface AreaPrefixEntry {
  area: string;
  prefix: string;
}

const normalizeWhitespace = (value: string): string => value.trim().replace(/\s+/g, " ");

const normalizeComparableText = (value: string): string =>
  normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const normalizeAreaName = (value: unknown): string => {
  const raw = normalizeWhitespace(typeof value === "string" ? value : "");
  if (!raw) return "";

  const comparable = normalizeComparableText(raw).replace(/[^\p{L}\p{N}]+/gu, " ");
  if (
    comparable === "tu do" ||
    comparable === "xa phuong tu do" ||
    comparable === "xa phuong tu do "
  ) {
    return FREE_AREA_NAME;
  }

  return raw;
};

export const normalizePrefix = (value: unknown): string =>
  normalizeWhitespace(typeof value === "string" ? value : "").toUpperCase();

export const isFreeAreaName = (value: unknown): boolean => normalizeAreaName(value) === FREE_AREA_NAME;

export const normalizeAreaPrefixEntry = (value: unknown): AreaPrefixEntry | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as { area?: unknown; prefix?: unknown };
  const area = normalizeAreaName(item.area);
  const prefix = normalizePrefix(item.prefix);

  if (!area) {
    return null;
  }

  if (isFreeAreaName(area)) {
    return { area: FREE_AREA_NAME, prefix: "" };
  }

  if (!prefix) {
    return null;
  }

  return { area, prefix };
};

export const normalizeAreaPrefixEntries = (value: unknown): AreaPrefixEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const entries: AreaPrefixEntry[] = [];

  for (const item of value) {
    const normalized = normalizeAreaPrefixEntry(item);
    if (!normalized) continue;

    const key = `${normalized.area}__${normalized.prefix}`;
    if (seen.has(key)) continue;

    seen.add(key);
    entries.push(normalized);
  }

  return entries;
};

export const getFallbackAreaPrefixes = (): AreaPrefixEntry[] => [{ area: FREE_AREA_NAME, prefix: "" }];

export const ensureAreaPrefixEntries = (value: unknown): AreaPrefixEntry[] => {
  const normalized = normalizeAreaPrefixEntries(value);
  return normalized.length > 0 ? normalized : getFallbackAreaPrefixes();
};

export const hasFlexibleArea = (value: unknown): boolean =>
  normalizeAreaPrefixEntries(value).some((entry) => isFreeAreaName(entry.area) && entry.prefix === "");
