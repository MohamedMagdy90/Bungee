import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    timeZone: "Asia/Qatar",
    // Website copy, customer-app copy (accounts, booking, tickets) and checkout/order copy, kept in separate files.
    messages: {
      ...(await import(`../../messages/${locale}.json`)).default,
      ...(await import(`../../messages/app.${locale}.json`)).default,
      ...(await import(`../../messages/pay.${locale}.json`)).default,
    },
  };
});
