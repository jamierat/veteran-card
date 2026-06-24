/**
 * PKPass generator for the Bullfrog Salutes Veterans Program.
 *
 * Same signing approach as the lunch punchcard (reuses the same Apple Pass Type
 * ID certificate). Certs loaded from env vars (Railway/production) or files:
 *   SIGNER_CERT_B64 / SIGNER_KEY_B64 / WWDR_CERT_B64  (base64), or
 *   ./certs/signerCert.pem, signerKey.pem, wwdr.pem
 */

const { execSync } = require('child_process');
const archiver = require('archiver');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { isPintAvailable, nextPintLabel, branchBirthdayLabel } = require('./lib');

const _certCache = {};
function resolveCert(envVar, filePath, label) {
  if (_certCache[label]) return _certCache[label];
  if (process.env[envVar]) {
    const tmpPath = path.join(os.tmpdir(), `bcb-salutes-${label}-${process.pid}.pem`);
    fs.writeFileSync(tmpPath, Buffer.from(process.env[envVar], 'base64'));
    _certCache[label] = tmpPath;
    return tmpPath;
  }
  if (fs.existsSync(filePath)) {
    _certCache[label] = filePath;
    return filePath;
  }
  throw new Error(`Missing cert: set ${envVar} env var or place file at ${filePath}`);
}

async function generatePass(member, baseUrl) {
  const certsDir = path.join(__dirname, 'certs');
  const imagesDir = path.join(__dirname, 'pass-images');

  const signerCertPath = resolveCert('SIGNER_CERT_B64', path.join(certsDir, 'signerCert.pem'), 'signerCert');
  const signerKeyPath  = resolveCert('SIGNER_KEY_B64',  path.join(certsDir, 'signerKey.pem'),  'signerKey');
  const wwdrPath       = resolveCert('WWDR_CERT_B64',   path.join(certsDir, 'wwdr.pem'),        'wwdr');

  const passJson = buildPassJson(member, baseUrl);
  const passJsonBuffer = Buffer.from(JSON.stringify(passJson, null, 2));

  const requiredImages = ['icon.png', 'icon@2x.png', 'logo.png', 'logo@2x.png'];
  // Apple Wallet ignores thumbnail when strip is present. We use the saluting
  // frog as the thumbnail, so we deliberately do NOT ship a strip image.
  const optionalImages = ['thumbnail.png', 'thumbnail@2x.png', 'thumbnail@3x.png', 'logo@3x.png'];

  const files = { 'pass.json': passJsonBuffer };

  for (const img of requiredImages) {
    const imgPath = path.join(imagesDir, img);
    if (!fs.existsSync(imgPath)) {
      throw new Error(`Missing image: pass-images/${img}. Run "node setup.js" to generate placeholder images.`);
    }
    files[img] = fs.readFileSync(imgPath);
  }
  for (const img of optionalImages) {
    const imgPath = path.join(imagesDir, img);
    if (fs.existsSync(imgPath)) files[img] = fs.readFileSync(imgPath);
  }

  // Manifest (SHA1 of every file)
  const manifest = {};
  for (const [name, buf] of Object.entries(files)) {
    manifest[name] = crypto.createHash('sha1').update(buf).digest('hex');
  }
  const manifestBuffer = Buffer.from(JSON.stringify(manifest));

  // Sign manifest with openssl (most reliable for Apple)
  const tmpId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const manifestTmp = path.join(os.tmpdir(), `bcb-salutes-manifest-${tmpId}.json`);
  const sigTmp      = path.join(os.tmpdir(), `bcb-salutes-sig-${tmpId}.der`);

  let signatureBuffer;
  try {
    fs.writeFileSync(manifestTmp, manifestBuffer);
    execSync(
      `openssl smime -binary -sign \
        -certfile "${wwdrPath}" \
        -signer "${signerCertPath}" \
        -inkey "${signerKeyPath}" \
        -in "${manifestTmp}" \
        -out "${sigTmp}" \
        -outform DER`,
      { stdio: 'pipe' }
    );
    signatureBuffer = fs.readFileSync(sigTmp);
  } catch (err) {
    throw new Error(`Signing failed: ${err.message}\n${err.stderr ? err.stderr.toString() : ''}`);
  } finally {
    try { fs.unlinkSync(manifestTmp); } catch (_) {}
    try { fs.unlinkSync(sigTmp);      } catch (_) {}
  }

  // Build ZIP (.pkpass) - no compression, Apple requires "store"
  const { Writable } = require('stream');
  return new Promise((resolve, reject) => {
    const chunks = [];
    const output = new Writable({ write(chunk, _, cb) { chunks.push(chunk); cb(); } });
    const archive = archiver('zip', { store: true });
    archive.on('error', reject);
    output.on('finish', () => resolve(Buffer.concat(chunks)));
    archive.pipe(output);
    for (const [name, buf] of Object.entries(files)) archive.append(buf, { name });
    archive.append(manifestBuffer, { name: 'manifest.json' });
    archive.append(signatureBuffer, { name: 'signature' });
    archive.finalize();
  });
}

function buildPassJson(member, baseUrl) {
  const teamId     = process.env.TEAM_ID     || 'YOURTEAMID';
  const passTypeId = process.env.PASS_TYPE_ID || 'pass.com.bullfrogcreekbrewing.lunchcard';
  const discount   = process.env.MILITARY_DISCOUNT_LABEL || '10% OFF';

  const verified   = !!member.verified;
  const pintReady  = isPintAvailable(member);

  const headerStatus = verified
    ? (member.status_type || 'Veteran').toUpperCase()   // VETERAN / ACTIVE DUTY / ...
    : 'PENDING';

  const pintValue = !verified
    ? 'Verify at the bar'
    : (pintReady ? 'Available now, show staff' : `Used, back ${nextPintLabel()}`);

  return {
    formatVersion: 1,
    passTypeIdentifier: passTypeId,
    serialNumber: member.pass_id,
    teamIdentifier: teamId,
    organizationName: 'Bullfrog Creek Brewing',
    description: 'Bullfrog Salutes Veterans Card',
    logoText: '',

    ...(process.env.WEB_SERVICE_URL ? {
      webServiceURL: process.env.WEB_SERVICE_URL,
      authenticationToken: member.auth_token || member.pass_id.replace(/-/g, ''),
    } : {}),

    // Military / camo palette: deep olive drab background, sand label, white text
    backgroundColor: 'rgb(45, 53, 33)',     // olive drab
    foregroundColor: 'rgb(245, 245, 235)',  // off-white
    labelColor:      'rgb(214, 192, 140)',  // field tan / sand

    generic: {
      // Top of the card: STATUS (VETERAN) + the ID / quick code - mirrors the lunch card
      headerFields: [
        { key: 'status', label: 'STATUS', value: headerStatus },
        { key: 'quickcode', label: 'ID CODE', value: member.short_code },
      ],
      primaryFields: [
        { key: 'member', label: 'BULLFROG SALUTES', value: member.name, textAlignment: 'PKTextAlignmentLeft' },
      ],
      secondaryFields: [
        { key: 'branch', label: 'BRANCH', value: member.branch || '-' },
        { key: 'discount', label: 'MILITARY DISCOUNT', value: verified ? discount : 'Verify at bar' },
      ],
      auxiliaryFields: [
        { key: 'pint', label: 'FREE PINT, ONE PER MONTH', value: pintValue },
      ],
      backFields: [
        {
          key: 'how',
          label: 'HOW IT WORKS',
          value: 'Show this card to your bartender. Verified veterans get the military discount on every visit, plus one free pint each calendar month. Staff scans the QR (or types your ID code) to redeem your monthly pint.',
        },
        {
          key: 'verify',
          label: 'GETTING VERIFIED',
          value: 'First visit: show a valid proof of service (military ID, VA ID card, or DD-214) to your bartender once. They verify you in the system and you are set for good.',
        },
        {
          key: 'birthday',
          label: 'FREE BIRTHDAY BEER',
          value: (branchBirthdayLabel(member.branch)
            ? `A free beer on the ${member.branch} birthday (${branchBirthdayLabel(member.branch)})`
            : 'A free beer on your branch birthday')
            + ' and on Veterans Day (Nov 11). Show your card that day.',
        },
        {
          key: 'terms',
          label: 'TERMS',
          value: 'One free pint per calendar month, dine-in only, house drafts up to a 16oz pour. Military discount and free pint are for the verified veteran only, non-transferable, no cash value. Bullfrog Creek Brewing reserves the right to verify service and modify the program.',
        },
        { key: 'thanks', label: 'THANK YOU', value: 'Thank you for your service. The Bullfrog Creek Brewing family' },
        { key: 'contact', label: 'QUESTIONS', value: 'Ask your bartender or visit bullfrogcreekbrewing.com' },
        { key: 'status_url', label: 'YOUR CARD ONLINE', value: `${baseUrl}/status/${member.pass_id}` },
      ],
    },

    barcodes: [
      {
        message:         `${baseUrl}/scan/${member.pass_id}`,
        format:          'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1',
        altText:         member.short_code,
      },
    ],
    barcode: {
      message:         `${baseUrl}/scan/${member.pass_id}`,
      format:          'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1',
      altText:         member.short_code,
    },
  };
}

module.exports = { generatePass };
