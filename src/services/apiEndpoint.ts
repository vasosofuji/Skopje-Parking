// The parking API runs as a Supabase Edge Function (supabase/functions/api).
export const PUBLIC_API_URL = "https://vkqxtqcuoobiijbnpxod.supabase.co/functions/v1/api";

export function apiEndpoint(options: {
  configured?: string;
  development: boolean;
  host: string;
  usbTest?: boolean;
}) {
  const value = options.configured?.trim() || (options.development
    ? `http://${options.host}:3001` : PUBLIC_API_URL);
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash)
    throw new Error("The parking API URL must not contain credentials or query parameters.");
  const usb = options.usbTest && url.origin === "http://127.0.0.1:3002";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (options.development || usb)))
    throw new Error("Connected parking builds require an HTTPS API.");
  const host = url.hostname.replace(/\.$/, "");
  if (!options.development && !usb && (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") ||
      /(^|\.)(localhost|local|internal|invalid|test)$/.test(host)))
    throw new Error("Connected parking builds require a public API address.");
  return value.replace(/\/+$/, "");
}
