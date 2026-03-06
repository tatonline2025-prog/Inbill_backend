import { promises as fs } from "fs";
import path from "path";

const ROOT = process.cwd();
const TARGET_DIR = path.join(ROOT, "src");
const TARGET_EXT = new Set([".ts", ".js"]);
const MOJIBAKE_PATTERN =
  /(áº|á»|Ã¡|Ã£|Ã¢|Ã¨|Ã©|Ãª|Ã¬|Ã­|Ã²|Ã³|Ã´|Ã¹|Ãº|Ã½|Ä‘|Æ°|Æ¡|âƒ£)/;

let updatedFiles = 0;
let updatedLines = 0;

const mojibakeScore = (text) => {
  const matches = text.match(
    /(áº|á»|Ã¡|Ã£|Ã¢|Ã¨|Ã©|Ãª|Ã¬|Ã­|Ã²|Ã³|Ã´|Ã¹|Ãº|Ã½|Ä‘|Æ°|Æ¡|âƒ£)/g
  );
  return matches ? matches.length : 0;
};

function maybeRepairLine(line) {
  if (!MOJIBAKE_PATTERN.test(line)) return line;

  const repaired = Buffer.from(line, "latin1").toString("utf8");
  const oldScore = mojibakeScore(line);
  const newScore = mojibakeScore(repaired);

  if (newScore < oldScore && !repaired.includes("\uFFFD")) {
    updatedLines += 1;
    return repaired;
  }
  return line;
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }
    if (!TARGET_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    await repairFile(fullPath);
  }
}

async function repairFile(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  let changed = false;

  const repairedLines = lines.map((line) => {
    const repaired = maybeRepairLine(line);
    if (repaired !== line) changed = true;
    return repaired;
  });

  if (!changed) return;
  updatedFiles += 1;
  await fs.writeFile(filePath, repairedLines.join("\n"), "utf8");
}

await walk(TARGET_DIR);
console.log(`fix-mojibake: updated files=${updatedFiles}, lines=${updatedLines}`);
