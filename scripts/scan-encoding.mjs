import { promises as fs } from "fs";
import path from "path";

const ROOT = process.cwd();
const ALLOWED_EXT = new Set([
  ".ts",
  ".js",
  ".mjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".ps1",
  ".html",
  ".css",
]);
const IGNORE_DIRS = new Set([".git", "node_modules", "dist", ".expo"]);
const SUSPICIOUS_TOKENS = [
  "Ã¡",
  "Ã£",
  "Ã¢",
  "Ã¨",
  "Ã©",
  "Ãª",
  "Ã¬",
  "Ã­",
  "Ã´",
  "Ã³",
  "Ã²",
  "Ãº",
  "Ã¹",
  "Ã½",
  "Ä‘",
  "Æ°",
  "Æ¡",
  "áº",
  "á»",
  "â€“",
  "â€œ",
  "â€\u009d",
  "\uFFFD",
];

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const issues = [];

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        await walk(fullPath);
      }
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) continue;
    await checkFile(fullPath);
  }
}

async function checkFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  if (rel === path.join("scripts", "scan-encoding.mjs")) return;
  if (rel === path.join("scripts", "fix-mojibake.mjs")) return;
  const bytes = await fs.readFile(filePath);
  let text = "";

  try {
    text = textDecoder.decode(bytes);
  } catch {
    issues.push({ file: rel, type: "invalid_utf8", detail: "Cannot decode as UTF-8" });
    return;
  }

  if (text.includes("\uFFFD")) {
    issues.push({ file: rel, type: "replacement_char", detail: "Contains U+FFFD replacement character" });
  }

  for (const token of SUSPICIOUS_TOKENS) {
    if (text.includes(token)) {
      issues.push({ file: rel, type: "possible_mojibake", detail: `Contains suspicious token: ${JSON.stringify(token)}` });
      break;
    }
  }
}

await walk(ROOT);

if (issues.length === 0) {
  console.log("Encoding scan passed: no UTF-8/mojibake issue detected.");
  process.exit(0);
}

console.error(`Encoding scan failed: found ${issues.length} issue(s).`);
for (const issue of issues) {
  console.error(`- [${issue.type}] ${issue.file} :: ${issue.detail}`);
}
process.exit(1);
