import type { LocationIssue } from "./locationWatch";

/** Keep the provider's reason for diagnostics while mapping known failures to a useful action. */
export function classifyLocationError(error: unknown): LocationIssue {
  const value = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  const detail = (typeof error === "string" ? error : typeof value.message === "string" ? value.message : "").replace(/[\r\n\t]+/g, " ").slice(0, 300);
  const reason = `${typeof value.code === "string" ? value.code : ""} ${detail}`.toLowerCase();
  const code: LocationIssue["code"] = /timeout|timed out/.test(reason) ? "timeout"
    : /permission|unauthori[sz]ed|denied|not authorized/.test(reason) ? "blocked"
    : /location.*(?:disabled|turned off)|services.*(?:disabled|off)|settings_unsatisfied/.test(reason) ? "services-off"
    : /not supported|unavailable.*browser/.test(reason) ? "unsupported" : "unavailable";
  return { code, ...(detail ? { detail } : {}) };
}

type Translate = (en: string, mk: string) => string;
export function locationIssueTitle(issue: LocationIssue | null, t: Translate) {
  switch (issue?.code) {
    case "denied": return t("Location permission denied", "Одбиена дозвола за локација");
    case "blocked": return t("Location permission blocked", "Блокирана дозвола за локација");
    case "services-off": return t("Location / GPS is switched off", "Локација / GPS е исклучена");
    case "timeout": return t("Location request timed out", "Истече барањето за локација");
    case "unsupported": return t("Location is not supported", "Локацијата не е поддржана");
    case "insecure": return t("Location requires a secure connection", "Локацијата бара безбедна врска");
    case "unavailable": return t("Location provider unavailable", "Сервисот за локација е недостапен");
    case "approximate": return t("Precise location is off", "Прецизната локација е исклучена");
    default: return t("Finding your location…", "Се бара вашата локација…");
  }
}

export function locationIssueAdvice(issue: LocationIssue | null, web: boolean, t: Translate) {
  switch (issue?.code) {
    case "denied": return t("Location permission was declined. Tap Try again and allow location when asked.", "Дозволата за локација е одбиена. Притиснете Обиди се повторно и дозволете локација.");
    case "blocked": return web
      ? t("Location is blocked for this site. Allow location in your browser’s site settings, then try again.", "Локацијата е блокирана за оваа страница. Дозволете локација во поставките на прелистувачот, па обидете се повторно.")
      : t("Location permission is blocked. Open settings, allow location while using the app, and enable Precise Location.", "Дозволата за локација е блокирана. Отворете поставки, дозволете локација при користење и вклучете прецизна локација.");
    case "services-off": return t("Location Services are switched off. Turn on your device’s Location / GPS setting, then return here.", "Услугите за локација се исклучени. Вклучете Локација / GPS на уредот, па вратете се тука.");
    case "timeout": return t("No fresh location arrived before the request timed out. Move outdoors or near a window and try again. Keep Wi-Fi or mobile data on for a faster fix.", "Не е добиена свежа локација навреме. Излезете надвор или до прозорец и обидете се повторно. Вклучете Wi-Fi или мобилни податоци за побрза локација.");
    case "approximate": return t("Skopje Parking has only approximate location, accurate to about 2 km. Parking alerts, reports at a parking and SMS payment prompts need precise location. Tap Allow precise location, or open settings and turn on Use precise location.", "Skopje Parking има само приближна локација, со точност од околу 2 km. Известувањата за паркинг, пријавите на паркинг и предлозите за SMS плаќање бараат прецизна локација. Притиснете Дозволи прецизна локација или отворете поставки и вклучете Користи прецизна локација.");
    case "insecure": return t("Browser location requires HTTPS. Open the secure app URL or use the Android/iOS app.", "Локацијата во прелистувач бара HTTPS. Отворете ја безбедната адреса или користете ја Android/iOS апликацијата.");
    case "unsupported": return t("This browser or device does not provide location. Use a supported browser or the Android/iOS app.", "Овој прелистувач или уред не нуди локација. Користете поддржан прелистувач или Android/iOS апликацијата.");
    default: return web
      ? t("Your browser’s location provider could not find a position. Check system Location Services and your internet connection, then try again.", "Сервисот на прелистувачот не ја најде локацијата. Проверете ја системската локација и интернет врската, па обидете се повторно.")
      : t("The device’s location provider could not find a position. Check Location Services, move outdoors or near a window, and try again.", "Сервисот на уредот не ја најде локацијата. Проверете ги услугите за локација, излезете надвор или до прозорец и обидете се повторно.");
  }
}
