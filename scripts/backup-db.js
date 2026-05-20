// Backup all collections to JSON files
const m = require('mongoose');
const fs = require('fs');
const path = require('path');

const URI = process.env.MONGO_URI;
if (!URI) { console.error('Set MONGO_URI env first'); process.exit(1); }

(async () => {
  await m.connect(URI);
  const db = m.connection.db;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(__dirname, '..', 'backups', `db_${ts}`);
  fs.mkdirSync(outDir, { recursive: true });

  const cols = await db.listCollections().toArray();
  console.log(`Found ${cols.length} collections. Output: ${outDir}`);
  for (const c of cols) {
    const docs = await db.collection(c.name).find({}).toArray();
    fs.writeFileSync(path.join(outDir, `${c.name}.json`), JSON.stringify(docs, null, 2));
    console.log(`  ${c.name}: ${docs.length} docs`);
  }
  await m.disconnect();
  console.log('Done. Backup at:', outDir);
})().catch(e => { console.error(e); process.exit(1); });
