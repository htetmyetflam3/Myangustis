import { encodeCookie } from './codec.js';
import { cookieSecureEnabled, cookieSameSite } from '../gateway/edge.js';

export const IDENTITY_COOKIE = 'userData';
export const IDENTITY_MAX_AGE = 15 * 24 * 60 * 60 * 1000;

export function setIdentityCookie(res, cookieData) {
  const existing = res.getHeader('Set-Cookie');
  const others = (Array.isArray(existing) ? existing : existing ? [existing] : [])
    .filter((entry) => !String(entry).startsWith(`${IDENTITY_COOKIE}=`));
  if (others.length) res.setHeader('Set-Cookie', others);
  else res.removeHeader('Set-Cookie');

  res.cookie(IDENTITY_COOKIE, encodeCookie(cookieData), {
    httpOnly: true,
    sameSite: cookieSameSite(),
    secure: cookieSecureEnabled(),
    maxAge: IDENTITY_MAX_AGE,
  });
}
