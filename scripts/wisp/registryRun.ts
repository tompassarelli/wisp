import { AssertionFailure, registeredTests } from "../../src/runtime/testing";
import { printResult } from "./devResult";
import { describeStack } from "./command";

export interface RegistryRequest {
  readonly preload: readonly string[];
  readonly modules: readonly string[];
}

export interface RegistryFailure {
  readonly test: string;
  readonly message: string;
}

export interface RegistryResult {
  readonly module: string;
  readonly passed: number;
  readonly failures: readonly RegistryFailure[];
  readonly milliseconds: number;
}

const STACK_LINES = 4;

const describe = (error: unknown) => {
  if (error instanceof AssertionFailure) return error.message;
  return describeStack(error, STACK_LINES);
};

async function readRequest(): Promise<RegistryRequest> {
  for await (const line of console) return JSON.parse(line) as RegistryRequest;
  throw new Error("no request on stdin");
}

if (import.meta.main) {
  const request = await readRequest();
  for (const path of request.preload) await import(path);
  for (const module of request.modules) {
    const started = performance.now();
    const before = registeredTests.length;
    const failures: RegistryFailure[] = [];
    try {
      await import(module);
    } catch (error) {
      failures.push({ test: "loads", message: describe(error) });
    }
    const added = registeredTests.slice(before);
    for (const { name, run } of added) {
      try {
        run();
      } catch (error) {
        failures.push({ test: name, message: describe(error) });
      }
    }
    const result: RegistryResult = { module, passed: added.length - failures.filter(({ test }) => test !== "loads").length, failures, milliseconds: performance.now() - started };
    printResult(result);
  }
  process.exit(0);
}
