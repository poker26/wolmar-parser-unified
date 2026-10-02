'use strict';

// The App Store screenshot fixture uses the owner's photos without publishing
// the original JPEG files in the source repository or shipping app bundle.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const archive = path.join(project, 'android-app', 'store-assets', 'appstore-1.0.1', 'screenshot-photos.enc.json');
const target = path.join(project, 'android-app', 'iosApp', 'ScreenshotPhotos');
const selected = [
  ['phone-007-obverse.jpg', 'kamchatka-2003-front.jpg'],
  ['phone-007-reverse.jpg', 'kamchatka-2003-back.jpg'],
  ['phone-024-obverse.jpg', 'somalia-leopard-2019.jpg'],
  ['phone-025-obverse.jpg', 'mongolia-snow-leopard-2017.jpg'],
];

function key() {
  const raw = process.env.NUMI_SCREENSHOT_PHOTO_KEY;
  if (!raw || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw new Error('NUMI_SCREENSHOT_PHOTO_KEY must be a base64 32-byte key.');
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== 32) throw new Error('Invalid encryption key length.');
  return decoded;
}

function jpeg(data) {
  return data.length > 1000 && data[0] === 0xff && data[1] === 0xd8 &&
    data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9;
}

function encrypt() {
  const source = process.env.NUMI_SCREENSHOT_SOURCE_DIR;
  if (!source || !path.isAbsolute(source)) throw new Error('Set NUMI_SCREENSHOT_SOURCE_DIR to the absolute photo directory.');
  const photos = selected.map(([input, output]) => {
    const data = fs.readFileSync(path.join(source, input));
    if (!jpeg(data)) throw new Error(`Invalid JPEG: ${input}`);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    cipher.setAAD(Buffer.from(output));
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    return { name: output, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') };
  });
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.writeFileSync(archive, JSON.stringify({ format: 'numi-screenshot-photos-v1', photos }));
  console.log(`Encrypted ${photos.length} photos for the iPhone screenshot build.`);
}

function decrypt() {
  const payload = JSON.parse(fs.readFileSync(archive, 'utf8'));
  if (payload.format !== 'numi-screenshot-photos-v1' || payload.photos?.length !== selected.length) throw new Error('Invalid photo archive.');
  const names = new Set(selected.map(([, output]) => output));
  fs.mkdirSync(target, { recursive: true });
  for (const photo of payload.photos) {
    if (!names.has(photo.name)) throw new Error('Unexpected photo name.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(photo.iv, 'base64'));
    decipher.setAAD(Buffer.from(photo.name));
    decipher.setAuthTag(Buffer.from(photo.tag, 'base64'));
    const data = Buffer.concat([decipher.update(Buffer.from(photo.data, 'base64')), decipher.final()]);
    if (!jpeg(data)) throw new Error(`Invalid JPEG: ${photo.name}`);
    fs.writeFileSync(path.join(target, photo.name), data, { flag: 'wx' });
  }
  console.log(`Prepared ${payload.photos.length} private photos for screenshot tests.`);
}

if (process.argv[2] === 'encrypt') encrypt();
else if (process.argv[2] === 'decrypt') decrypt();
else throw new Error('Expected encrypt or decrypt.');
