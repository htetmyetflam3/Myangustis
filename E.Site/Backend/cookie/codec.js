import crypto from 'node:crypto';
const SECRET = process.env.COOKIE_SECRET;
if (!SECRET || SECRET.length < 32) {
  throw new Error('COOKIE_SECRET must be set to at least 32 characters');
}
const KEY = crypto.createHash('sha256').update(SECRET, 'utf8').digest();
const VERSION = 'v1';
const IV_BYTES = 12;
export function encodeCookie(data) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  cipher.setAAD(Buffer.from(VERSION));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}
export function decodeCookie(value) {
  try {
    if (typeof value !== 'string' || value.length > 8192) return null;
    const [version, ivText, encryptedText, tagText, extra] = value.split('.');
    if (version !== VERSION || !ivText || !encryptedText || !tagText || extra) return null;
    const iv = Buffer.from(ivText, 'base64url');
    const encrypted = Buffer.from(encryptedText, 'base64url');
    const tag = Buffer.from(tagText, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== 16 || encrypted.length === 0) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAAD(Buffer.from(VERSION));
    decipher.setAuthTag(tag);
    const json = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
    const parsed = JSON.parse(json);
    return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}