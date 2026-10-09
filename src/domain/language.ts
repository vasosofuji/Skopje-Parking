import translations from "../locales/translations.json";

export const LANGUAGES = [
  { code: "en", name: "English", englishName: "English", flag: "gb" },
  { code: "mk", name: "Македонски", englishName: "Macedonian", flag: "mk" },
  { code: "tr", name: "Türkçe", englishName: "Turkish", flag: "tr" },
  { code: "sq", name: "Shqip", englishName: "Albanian", flag: "al" },
] as const;
export type Language = (typeof LANGUAGES)[number]["code"];
export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some(({ code }) => code === value);
}
/** A place's name in the driver's language. Generated "Parking near <street>" names are
 * translated for Turkish and Albanian instead of showing English. */
export function placeName(place: { name: string; nameEn?: string }, language: Language) {
  if (language === "mk") return place.name;
  const near = language !== "en" && place.nameEn?.match(/^Parking near (.+)$/);
  return near ? translate(language, "Parking near {street}", "Паркинг · до {street}").replace("{street}", near[1]) : place.nameEn ?? place.name;
}
export function translate(language: Language, en: string, mk: string): string {
  if (language === "mk") return mk;
  if (language === "en") return en;
  const entry = (translations as Record<string, { tr: string; sq: string }>)[en];
  return entry?.[language] ?? en;
}
