require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const cors = require('cors');
const db = require('./database');
const { generatePass } = require('./pass-generator');
const { currentMonth, isPintAvailable, nextPintLabel, birthdayOccasion } = require('./lib');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));
app.use('/pass-images', express.static('pass-images'));

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const STAFF_CODE = process.env.STAFF_CODE || process.env.BARTENDER_CODE || 'BULLFROG';
const DISCOUNT = process.env.MILITARY_DISCOUNT_LABEL || '10% OFF';

// ─────────────────────────────────────────────
// APNs push helper - tells Apple Wallet to re-fetch the pass after a change
// ─────────────────────────────────────────────
let _apnProvider = null;
function getApnProvider() {
  if (_apnProvider) return _apnProvider;
  try {
    const apn = require('apn');
    let certData, keyData;
    if (process.env.SIGNER_CERT_B64 && process.env.SIGNER_KEY_B64) {
      certData = Buffer.from(process.env.SIGNER_CERT_B64, 'base64').toString('utf8');
      keyData  = Buffer.from(process.env.SIGNER_KEY_B64,  'base64').toString('utf8');
    } else {
      const certPath = path.join(__dirname, 'certs', 'signerCert.pem');
      const keyPath  = path.join(__dirname, 'certs', 'signerKey.pem');
      if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) return null;
      certData = fs.readFileSync(certPath, 'utf8');
      keyData  = fs.readFileSync(keyPath,  'utf8');
    }
    _apnProvider = new apn.Provider({
      cert: certData, key: keyData,
      production: process.env.APN_PRODUCTION === 'true',
    });
    return _apnProvider;
  } catch (e) {
    console.warn('APNs not available:', e.message);
    return null;
  }
}

async function pushPassUpdate(passId) {
  const provider = getApnProvider();
  if (!provider) return;
  const registrations = db.prepare(
    'SELECT push_token FROM device_registrations WHERE serial_number = ?'
  ).all(passId);
  if (registrations.length === 0) return;
  const apn = require('apn');
  const note = new apn.Notification();
  note.topic = process.env.PASS_TYPE_ID || 'pass.com.bullfrogcreekbrewing.lunchcard';
  note.payload = {};
  for (const reg of registrations) {
    try {
      const result = await provider.send(note, reg.push_token);
      if (result.failed.length > 0) console.warn('APNs push failed', result.failed[0].response);
    } catch (e) { console.warn('APNs push error:', e.message); }
  }
}

function memberPublic(m) {
  const available = isPintAvailable(m);
  // Birthday / Veterans Day free beer (only on that calendar day)
  const occ = birthdayOccasion(m);
  let birthdayRedeemed = false;
  if (occ) {
    birthdayRedeemed = !!db.prepare(
      'SELECT 1 FROM birthday_redemptions WHERE pass_id = ? AND occasion_date = ?'
    ).get(m.pass_id, occ.date);
  }
  return {
    passId:       m.pass_id,
    shortCode:    m.short_code,
    name:         m.name,
    branch:       m.branch,
    statusType:   m.status_type || 'Veteran',
    verified:     !!m.verified,
    discount:     DISCOUNT,
    pintAvailable: available,
    pintUsedThisMonth: m.verified ? !available : false,
    nextPint:     available ? null : nextPintLabel(),
    birthdayToday:      occ ? occ.label : null,
    birthdayAvailable:  !!occ && !!m.verified && !birthdayRedeemed,
    birthdayRedeemed:   !!occ && birthdayRedeemed,
    totalPints:   m.total_pints || 0,
    totalVisits:  m.total_visits || 0,
    statusUrl:    `${BASE_URL}/status/${m.pass_id}`,
  };
}

// ─────────────────────────────────────────────
// MEMBER: Register and get a pass
// ─────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  try {
    const { name, branch, statusType, phone, email } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });

    const passId    = uuidv4();
    const shortCode = passId.replace(/-/g, '').substring(0, 6).toUpperCase();
    const authToken = uuidv4().replace(/-/g, '');

    db.prepare(`
      INSERT INTO members (pass_id, short_code, auth_token, name, branch, status_type, phone, email, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      passId, shortCode, authToken, name.trim(),
      branch || null, statusType || 'Veteran', phone || null, email || null
    );

    res.json({
      passId, shortCode, name: name.trim(),
      downloadUrl: `${BASE_URL}/api/pass/${passId}/download`,
      statusUrl:   `${BASE_URL}/status/${passId}`,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// MEMBER: Download .pkpass
// ─────────────────────────────────────────────
app.get('/api/pass/:passId/download', async (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE pass_id = ?').get(req.params.passId);
  if (!member) return res.status(404).json({ error: 'Pass not found.' });
  try {
    const passBuffer = await generatePass(member, BASE_URL);
    res.set({
      'Content-Type':        'application/vnd.apple.pkpass',
      'Content-Disposition': 'attachment; filename="bullfrog-salutes.pkpass"',
      'Content-Length':      passBuffer.length,
    });
    res.send(passBuffer);
  } catch (err) {
    console.error('Pass generation error:', err.message);
    res.status(500).json({
      error: 'Apple Wallet pass signing not configured.',
      fallback: `${BASE_URL}/status/${member.pass_id}`,
      details: err.message,
    });
  }
});

// ─────────────────────────────────────────────
// MEMBER: Status JSON + page
// ─────────────────────────────────────────────
app.get('/api/member/:passId', (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE pass_id = ?').get(req.params.passId);
  if (!member) return res.status(404).json({ error: 'Not found.' });
  res.json(memberPublic(member));
});
app.get('/status/:passId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

// ─────────────────────────────────────────────
// STAFF: QR scan deep-link → opens staff page with member pre-loaded
// ─────────────────────────────────────────────
app.get('/scan/:passId', (req, res) => {
  res.redirect(`/staff.html?passId=${encodeURIComponent(req.params.passId)}`);
});

// ─────────────────────────────────────────────
// STAFF: Look up by passId or short code
// ─────────────────────────────────────────────
app.get('/api/lookup', (req, res) => {
  const { id, code } = req.query;
  let member;
  if (id)        member = db.prepare('SELECT * FROM members WHERE pass_id = ?').get(id);
  else if (code) member = db.prepare('SELECT * FROM members WHERE short_code = ?').get(code.toUpperCase().trim());
  if (!member) return res.status(404).json({ error: 'Member not found.' });
  res.json(memberPublic(member));
});

// ─────────────────────────────────────────────
// STAFF: Verify a veteran (one-time, after checking proof of service)
// ─────────────────────────────────────────────
app.post('/api/verify', (req, res) => {
  const { passId, shortCode, code, staffCode, staffName } = req.body;
  if (staffCode !== STAFF_CODE) return res.status(401).json({ error: 'Wrong staff code. Try again.' });

  const lookupCode = shortCode || code;
  let member;
  if (passId) member = db.prepare('SELECT * FROM members WHERE pass_id = ?').get(passId);
  else if (lookupCode) member = db.prepare('SELECT * FROM members WHERE short_code = ?').get(lookupCode.toUpperCase().trim());
  if (!member) return res.status(404).json({ error: 'Member not found.' });

  if (member.verified) {
    return res.json({ success: true, alreadyVerified: true, message: `${member.name} is already verified.`, member: memberPublic(member) });
  }

  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE members SET verified = 1, verified_at = ?, verified_by = ?, pass_updated_at = ?
    WHERE pass_id = ?
  `).run(nowIso, staffName || 'staff', nowIso, member.pass_id);

  pushPassUpdate(member.pass_id).catch(e => console.warn('Push error:', e.message));
  const updated = db.prepare('SELECT * FROM members WHERE pass_id = ?').get(member.pass_id);
  res.json({
    success: true,
    message: `✓ ${member.name} verified. ${DISCOUNT} military discount is now active, and their free monthly pint is unlocked.`,
    member: memberPublic(updated),
  });
});

// ─────────────────────────────────────────────
// STAFF: Redeem the free monthly pint (one per calendar month)
// ─────────────────────────────────────────────
app.post('/api/redeem-pint', (req, res) => {
  const { passId, shortCode, code, staffCode, staffName } = req.body;
  if (staffCode !== STAFF_CODE) return res.status(401).json({ error: 'Wrong staff code. Try again.' });

  const lookupCode = shortCode || code;
  let member;
  if (passId) member = db.prepare('SELECT * FROM members WHERE pass_id = ?').get(passId);
  else if (lookupCode) member = db.prepare('SELECT * FROM members WHERE short_code = ?').get(lookupCode.toUpperCase().trim());
  if (!member) return res.status(404).json({ error: 'Member not found.' });

  if (!member.verified) {
    return res.status(400).json({ error: `${member.name} is not verified yet. Check proof of service and tap Verify first.` });
  }

  const month = currentMonth();
  if (member.last_pint_month === month) {
    return res.status(409).json({
      error: `${member.name} already used their free pint this month. Next one unlocks ${nextPintLabel()}.`,
      nextPint: nextPintLabel(),
    });
  }

  const nowIso = new Date().toISOString();
  // Record the redemption and bump the member atomically. The unique index on
  // (pass_id, redeemed_month) is the real guard against a double-redeem race.
  const redeem = db.transaction(() => {
    db.prepare(`INSERT INTO pint_redemptions (pass_id, redeemed_month, redeemed_at, bartender) VALUES (?, ?, ?, ?)`)
      .run(member.pass_id, month, nowIso, staffName || 'staff');
    db.prepare(`
      UPDATE members
      SET last_pint_month = ?, last_pint_at = ?,
          total_pints = COALESCE(total_pints, 0) + 1,
          total_visits = COALESCE(total_visits, 0) + 1,
          pass_updated_at = ?
      WHERE pass_id = ?
    `).run(month, nowIso, nowIso, member.pass_id);
  });
  try {
    redeem();
  } catch (e) {
    if (String(e.code).includes('CONSTRAINT') || /UNIQUE/i.test(e.message)) {
      return res.status(409).json({
        error: `${member.name} already used their free pint this month. Next one unlocks ${nextPintLabel()}.`,
        nextPint: nextPintLabel(),
      });
    }
    console.error('redeem-pint error:', e.message);
    return res.status(500).json({ error: 'Could not redeem right now. Try again.' });
  }

  pushPassUpdate(member.pass_id).catch(e => console.warn('Push error:', e.message));
  const updated = db.prepare('SELECT * FROM members WHERE pass_id = ?').get(member.pass_id);
  res.json({
    success: true,
    message: `Free pint redeemed for ${member.name}! Next free pint unlocks ${nextPintLabel()}.`,
    member: memberPublic(updated),
  });
});

// ─────────────────────────────────────────────
// STAFF: Redeem the branch-birthday / Veterans Day free beer (once per occasion)
// ─────────────────────────────────────────────
app.post('/api/redeem-birthday', (req, res) => {
  const { passId, shortCode, code, staffCode, staffName } = req.body;
  if (staffCode !== STAFF_CODE) return res.status(401).json({ error: 'Wrong staff code. Try again.' });

  const lookupCode = shortCode || code;
  let member;
  if (passId) member = db.prepare('SELECT * FROM members WHERE pass_id = ?').get(passId);
  else if (lookupCode) member = db.prepare('SELECT * FROM members WHERE short_code = ?').get(lookupCode.toUpperCase().trim());
  if (!member) return res.status(404).json({ error: 'Member not found.' });

  if (!member.verified) {
    return res.status(400).json({ error: `${member.name} is not verified yet. Check proof of service and tap Verify first.` });
  }

  const occ = birthdayOccasion(member);
  if (!occ) {
    return res.status(400).json({ error: `No birthday beer today for ${member.name}. It unlocks on their branch birthday and on Veterans Day.` });
  }

  const nowIso = new Date().toISOString();
  // Atomic: record the birthday beer and bump the visit count together.
  const redeem = db.transaction(() => {
    db.prepare(`INSERT INTO birthday_redemptions (pass_id, occasion_date, occasion_label, redeemed_at, bartender) VALUES (?, ?, ?, ?, ?)`)
      .run(member.pass_id, occ.date, occ.label, nowIso, staffName || 'staff');
    db.prepare(`UPDATE members SET total_visits = COALESCE(total_visits,0) + 1, pass_updated_at = ? WHERE pass_id = ?`)
      .run(nowIso, member.pass_id);
  });
  try {
    redeem();
  } catch (e) {
    if (String(e.code).includes('CONSTRAINT') || /UNIQUE/i.test(e.message)) {
      return res.status(409).json({ error: `${member.name} already claimed their ${occ.label} beer today.` });
    }
    console.error('redeem-birthday error:', e.message);
    return res.status(500).json({ error: 'Could not redeem right now. Try again.' });
  }

  pushPassUpdate(member.pass_id).catch(e => console.warn('Push error:', e.message));
  const updated = db.prepare('SELECT * FROM members WHERE pass_id = ?').get(member.pass_id);
  res.json({
    success: true,
    message: `Happy ${occ.label}! Free beer redeemed for ${member.name}.`,
    member: memberPublic(updated),
  });
});

// ─────────────────────────────────────────────
// ADMIN
// ─────────────────────────────────────────────
app.get('/api/admin/members', (req, res) => {
  if (req.query.staffCode !== STAFF_CODE) return res.status(401).json({ error: 'Unauthorized.' });
  const members = db.prepare(`
    SELECT pass_id, short_code, name, branch, status_type, phone, email,
           verified, verified_at, last_pint_month, total_pints, total_visits, created_at
    FROM members ORDER BY created_at DESC
  `).all();
  res.json(members.map(m => ({ ...m, pintAvailable: isPintAvailable(m) })));
});

app.get('/api/admin/export/emails', (req, res) => {
  if (req.query.staffCode !== STAFF_CODE) return res.status(401).json({ error: 'Unauthorized.' });
  const members = db.prepare(`
    SELECT name, email, phone, branch, status_type, verified, total_pints, total_visits, created_at
    FROM members ORDER BY created_at DESC
  `).all();
  const rows = [
    ['Name', 'Email', 'Phone', 'Branch', 'Status', 'Verified', 'Free Pints', 'Total Visits', 'Joined'],
    ...members.map(m => [m.name, m.email || '', m.phone || '', m.branch || '', m.status_type || '',
      m.verified ? 'Yes' : 'No', m.total_pints || 0, m.total_visits || 0, m.created_at]),
  ];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  res.set({
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="bullfrog-salutes-members-${new Date().toISOString().slice(0,10)}.csv"`,
  });
  res.send(csv);
});

// NOTE: The data-wipe endpoint was intentionally removed. Wiping all members is
// destructive and must never be reachable over the web (not even with the staff
// PIN). To clear data, run `node wipe.js` inside the server (Railway console) —
// this is done from Cowork by the owner only.

app.get('/api/qr', async (req, res) => {
  const { data } = req.query;
  if (!data) return res.status(400).json({ error: 'data param required' });
  const qr = await QRCode.toDataURL(data, { width: 300, margin: 2 });
  res.json({ qr });
});

// ═════════════════════════════════════════════════════════════════════════════
// APPLE WALLET WEB SERVICE API (same spec as the lunch card)
// ═════════════════════════════════════════════════════════════════════════════
function verifyPassAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  return authHeader.replace(/^ApplePass\s+/i, '').trim();
}

app.post('/v1/devices/:deviceId/registrations/:passTypeId/:serialNumber', (req, res) => {
  const { deviceId, serialNumber } = req.params;
  const { pushToken } = req.body;
  const token = verifyPassAuth(req);
  const member = db.prepare('SELECT * FROM members WHERE pass_id = ?').get(serialNumber);
  if (!member) return res.status(404).send();
  if (token !== (member.auth_token || member.pass_id.replace(/-/g, ''))) return res.status(401).send();

  const existing = db.prepare('SELECT * FROM device_registrations WHERE device_library_id = ? AND serial_number = ?').get(deviceId, serialNumber);
  if (existing) {
    db.prepare('UPDATE device_registrations SET push_token = ? WHERE device_library_id = ? AND serial_number = ?').run(pushToken, deviceId, serialNumber);
    return res.status(200).send();
  }
  db.prepare(`INSERT INTO device_registrations (device_library_id, push_token, pass_type_id, serial_number) VALUES (?, ?, ?, ?)`)
    .run(deviceId, pushToken, req.params.passTypeId, serialNumber);
  res.status(201).send();
});

app.delete('/v1/devices/:deviceId/registrations/:passTypeId/:serialNumber', (req, res) => {
  const { deviceId, serialNumber } = req.params;
  const token = verifyPassAuth(req);
  const member = db.prepare('SELECT * FROM members WHERE pass_id = ?').get(serialNumber);
  if (!member) return res.status(404).send();
  if (token !== (member.auth_token || member.pass_id.replace(/-/g, ''))) return res.status(401).send();
  db.prepare('DELETE FROM device_registrations WHERE device_library_id = ? AND serial_number = ?').run(deviceId, serialNumber);
  res.status(200).send();
});

app.get('/v1/devices/:deviceId/registrations/:passTypeId', (req, res) => {
  const { deviceId } = req.params;
  const { passesUpdatedSince } = req.query;
  let query = `
    SELECT m.pass_id, m.pass_updated_at FROM members m
    JOIN device_registrations d ON m.pass_id = d.serial_number
    WHERE d.device_library_id = ?`;
  const params = [deviceId];
  if (passesUpdatedSince) { query += ' AND m.pass_updated_at > ?'; params.push(passesUpdatedSince); }
  const rows = db.prepare(query).all(...params);
  if (rows.length === 0) return res.status(204).send();
  const lastUpdated = rows.reduce((max, r) => (r.pass_updated_at > max ? r.pass_updated_at : max), rows[0].pass_updated_at);
  res.json({ lastUpdated, serialNumbers: rows.map(r => r.pass_id) });
});

app.get('/v1/passes/:passTypeId/:serialNumber', async (req, res) => {
  const { serialNumber } = req.params;
  const token = verifyPassAuth(req);
  const member = db.prepare('SELECT * FROM members WHERE pass_id = ?').get(serialNumber);
  if (!member) return res.status(404).send();
  if (token !== (member.auth_token || member.pass_id.replace(/-/g, ''))) return res.status(401).send();
  try {
    const passBuffer = await generatePass(member, BASE_URL);
    res.set({
      'Content-Type':  'application/vnd.apple.pkpass',
      'Last-Modified': new Date(member.pass_updated_at || member.created_at).toUTCString(),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma':        'no-cache',
    });
    res.send(passBuffer);
  } catch (err) {
    console.error('[Wallet] Pass fetch error:', err.message);
    res.status(500).send();
  }
});

app.post('/v1/log', (req, res) => {
  const { logs } = req.body || {};
  if (logs && logs.length) console.log('[Apple Wallet Logs]', logs.join('\n'));
  res.status(200).send();
});

app.listen(PORT, () => {
  console.log(`\nBullfrog Salutes - Veterans Program`);
  console.log(`   Server:    http://localhost:${PORT}`);
  console.log(`   Register:  http://localhost:${PORT}/register.html`);
  console.log(`   Staff:     http://localhost:${PORT}/staff.html`);
  console.log(`   Staff code: ${STAFF_CODE}`);
  console.log(`   Discount:   ${DISCOUNT}`);
  console.log(process.env.WEB_SERVICE_URL ? `   Auto-update: ENABLED` : `   Auto-update: disabled (set WEB_SERVICE_URL)`);
  console.log('');
});
