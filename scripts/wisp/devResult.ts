export const RESULT_PREFIX = "@@wisp-dev ";

export const printResult = (value: unknown) => console.log(`${RESULT_PREFIX}${JSON.stringify(value)}`);

export const WARM_ENV = "WISP_DEV_WARM";

export const SAVED_FILES_ENV = "WISP_DEV_FILES";

export function savedFiles(): readonly string[] | undefined {
  const value = process.env[SAVED_FILES_ENV];
  if (value === undefined) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((path) => typeof path === "string")) throw new Error(`${SAVED_FILES_ENV} is not a list of paths`);
  return parsed;
}
