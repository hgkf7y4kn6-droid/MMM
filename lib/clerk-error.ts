import { isClerkAPIResponseError } from "@clerk/clerk-expo";

/** Turn a Clerk (or unknown) error into one readable sentence for the UI. */
export function getClerkErrorMessage(error: unknown): string {
  if (isClerkAPIResponseError(error)) {
    const first = error.errors[0];
    return first?.longMessage || first?.message || "Something went wrong.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}
