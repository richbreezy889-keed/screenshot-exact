import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { LANG_COOKIE, type Lang } from "./i18n";

const isLang = (value: string | undefined): value is Lang => value === "en" || value === "sw";

/**
 * Reads the language the visitor last chose. Runs on the server during SSR so
 * the first HTML already contains the right language (no English flash), and
 * its result is dehydrated into the router context for hydration.
 */
export const readStoredLang = createServerFn({ method: "GET" }).handler(async (): Promise<Lang> => {
  const value = getCookie(LANG_COOKIE);
  return isLang(value) ? value : "en";
});
