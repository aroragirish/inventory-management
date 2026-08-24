import { z } from "zod";

export type FieldErrors = Record<string, string>;

export type ActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

export function fail(error: string, fieldErrors?: FieldErrors): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

export function done<T>(message: string, data?: T): ActionResult<T> {
  return { ok: true, message, data };
}

/** Turn a Zod failure into one message plus per-field messages for the form. */
export function fromZod(error: z.ZodError): ActionResult<never> {
  const flat = z.flattenError(error);
  const fieldErrors: FieldErrors = {};
  for (const [field, messages] of Object.entries(
    flat.fieldErrors as Record<string, string[] | undefined>,
  )) {
    if (messages?.length) fieldErrors[field] = messages[0];
  }
  const first =
    flat.formErrors[0] ?? Object.values(fieldErrors)[0] ?? "Please check the form.";
  return { ok: false, error: first, fieldErrors };
}

/** Wrap an action body so thrown errors surface as a clean message. */
export async function guard<T>(
  fn: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    // Next uses thrown control-flow objects for redirect/notFound — never swallow those.
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      typeof (error as { digest?: unknown }).digest === "string"
    ) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Something went wrong.";
    console.error("[action]", error);
    return fail(message);
  }
}
