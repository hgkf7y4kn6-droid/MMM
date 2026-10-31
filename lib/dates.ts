import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

/** How dates are typed in forms. */
export const DATE_FORMAT = "MM/DD/YYYY";
const ACCEPTED = ["MM/DD/YYYY", "M/D/YYYY", "MM/DD/YY", "M/D/YY", "YYYY-MM-DD"];

/** A typed date, or null if it isn't a real date in an accepted format. */
export const parseUserDate = (text: string) => {
  const d = dayjs(text.trim(), ACCEPTED, true);
  return d.isValid() ? d : null;
};

/** ISO (YYYY-MM-DD) -> the form's format; "" for null. */
export const toFormDate = (iso: string | null | undefined) => (iso ? dayjs(iso).format(DATE_FORMAT) : "");
