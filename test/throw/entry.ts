import { configureRuntime } from "../../src/runtime/config";
import { installDispatch, on, trampoline } from "../../src/platform/dispatch";

declare function MissingNative(this: void): void;

function fail(message: string): never {
  throw new Error(message);
}

function rethrow(): void {
  try {
    fail("rethrown failure");
  } catch (error) {
    throw error;
  }
}

function faultAfterCatch(): void {
  try {
    fail("caught failure");
  } catch {
    MissingNative();
  }
}

export function run(): void {
  configureRuntime({ filePrefix: "throw", readyPrefix: "TR", globalPrefix: "__throwFixture" });
  installDispatch();
  on("thrown", () => fail("thrown failure"));
  on("rethrown", rethrow);
  on("fault", faultAfterCatch);
  trampoline("thrown")();
  trampoline("rethrown")();
  trampoline("fault")();
}
