import { DEFAULT_PHONE_PREFIX } from "@menucito/shared";

export interface PhonePrefixOption {
  prefix: string;
  country: string;
}

/** Prefixes offered in the member form; the API accepts any `+` and 1 to 3 digits. */
export const PHONE_PREFIXES: readonly PhonePrefixOption[] = [
  { prefix: "+54", country: "Argentina" },
  { prefix: "+598", country: "Uruguay" },
  { prefix: "+595", country: "Paraguay" },
  { prefix: "+56", country: "Chile" },
  { prefix: "+55", country: "Brasil" },
  { prefix: "+591", country: "Bolivia" },
  { prefix: "+51", country: "Perú" },
  { prefix: "+57", country: "Colombia" },
  { prefix: "+58", country: "Venezuela" },
  { prefix: "+593", country: "Ecuador" },
  { prefix: "+52", country: "México" },
  { prefix: "+34", country: "España" },
  { prefix: "+1", country: "EE. UU. y Canadá" },
];

export interface PhoneParts {
  prefix: string;
  number: string;
}

/**
 * Splits the E.164 phone the API returns back into the form fields. `+5491112345678` becomes
 * `+54` and `1112345678` (the mobile `9` is dropped: the API adds it again). A prefix that is not in
 * `PHONE_PREFIXES` is cut at the longest known match; with none, it all goes to the number.
 */
export function splitPhone(phone: string | null | undefined): PhoneParts {
  if (!phone) return { prefix: DEFAULT_PHONE_PREFIX, number: "" };
  const known = [...PHONE_PREFIXES]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((option) => phone.startsWith(option.prefix));
  if (!known) return { prefix: DEFAULT_PHONE_PREFIX, number: phone.replace(/\D/g, "") };
  const rest = phone.slice(known.prefix.length);
  const number = known.prefix === DEFAULT_PHONE_PREFIX && rest.startsWith("9") ? rest.slice(1) : rest;
  return { prefix: known.prefix, number };
}

/** Phone as the user list shows it: the prefix and the number. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const { prefix, number } = splitPhone(phone);
  return `${prefix} ${number}`;
}
