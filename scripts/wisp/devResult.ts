// How a dev-loop child process hands its result to the loop: one line with
// this prefix and a JSON value. Its other output is the tests' own.
export const RESULT_PREFIX = "@@wisp-dev ";

export const printResult = (value: unknown) => console.log(`${RESULT_PREFIX}${JSON.stringify(value)}`);
