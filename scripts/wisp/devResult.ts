// How a dev-loop child process hands its result to the loop: one line with
// this prefix and a JSON value. Its other output is the tests' own. And how
// the loop tells a per-file audit which saved files to check.
export const RESULT_PREFIX = "@@wisp-dev ";

export const printResult = (value: unknown) => console.log(`${RESULT_PREFIX}${JSON.stringify(value)}`);

/** The installed modules a waiting Bun test process loads before a save (wisp:scripts/wisp/testWait.ts). */
export const WARM_ENV = "WISP_DEV_WARM";

/** Where `wisp dev` tells a per-file audit the saved files it reads. */
export const SAVED_FILES_ENV = "WISP_DEV_FILES";

/** Under `wisp dev`, the saved files a per-file audit should check, as absolute paths; undefined when it should check everything. */
export function savedFiles(): readonly string[] | undefined {
  const value = process.env[SAVED_FILES_ENV];
  if (value === undefined) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((path) => typeof path === "string")) throw new Error(`${SAVED_FILES_ENV} is not a list of paths`);
  return parsed;
}
