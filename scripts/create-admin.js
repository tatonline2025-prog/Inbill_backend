require('dotenv').config();
const m = require('mongoose');
const bcrypt = require('bcryptjs');

(async () => {
  await m.connect(process.env.MONGO_URI);
  const c = m.connection.db.collection('users');
  const exists = await c.findOne({ username: 'admin' });
  const hash = await bcrypt.hash('Admin@123', 10);
  if (exists) {
    await c.updateOne(
      { username: 'admin' },
      { $set: { password: hash, role: 'admin', fullName: 'Admin Toan', updatedAt: new Date() } }
    );
    console.log('UPDATED existing admin');
  } else {
    const r = await c.insertOne({
      username: 'admin',
      password: hash,
      fullName: 'Admin Toan',
      phone: '0900000001',
      bankAccount: 'ADMIN-NEW-001',
      role: 'admin',
      usertype: 'admin',
      province: '',
      areaPrefixes: [{ area: 'Tự do', prefix: '' }],
      stt: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log('CREATED admin id=', r.insertedId.toString());
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
