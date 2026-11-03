import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { appSecret } from "../runtime";

/**
 * R3: each reservation's QR code opens /{locale}/ticket?c={code}&s={signature}. The signature (HMAC of the code)
 * means tickets can't be guessed or enumerated; the front desk scans it to see and check in the booking.
 */
export function ticketSignature(code: string) {
  return createHmac("sha256", appSecret()).update(`ticket:${code}`).digest("base64url").slice(0, 22);
}

export function verifyTicketSignature(code: string, signature: string | null | undefined) {
  if (!signature) return false;
  const expected = Buffer.from(ticketSignature(code));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function ticketUrl(origin: string, locale: string, code: string) {
  return `${origin}/${locale}/ticket?c=${encodeURIComponent(code)}&s=${ticketSignature(code)}`;
}

/** Navy-on-transparent SVG QR, scaled by CSS. Error correction M survives screen glare. */
export async function ticketQrSvg(url: string) {
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 0,
    color: { dark: "#0B1F33", light: "#00000000" },
  });
}
