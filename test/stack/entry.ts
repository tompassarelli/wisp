import { configureRuntime } from "../../src/runtime/config";
import { installDispatch, on, trampoline } from "../../src/platform/dispatch";
import { restoreStack, stackDepth, traceback } from "../../src/platform/errors";

function deepest(): never {
  throw new Error("original failure");
}

function invoke(callback: (this: void) => void): void {
  callback();
}

function nested(): void {
  invoke(deepest);
}

export function fail(): void {
  configureRuntime({ filePrefix: "stack", announcePrefix: "S", readyPrefix: "SR", globalPrefix: "__stackFixture" });
  installDispatch();
  on("nested failure", nested);
  trampoline("nested failure")();
}

function leaf(value: number): number {
  return value + 1;
}

export function normal(value: number): number {
  return leaf(value) + leaf(value + 1);
}

export function multiple(): LuaMultiReturn<[number, undefined, string, undefined]> {
  return $multi(7, undefined, "third", undefined);
}

export function forwarded(): LuaMultiReturn<[number, undefined, string, undefined]> {
  return multiple();
}

export function empty(): void {}

export function caught(): number {
  try {
    nested();
  } catch {
    return normal(10);
  }
  return 0;
}

export function identity(): boolean {
  const original = new Error("identity");
  try {
    throw original;
  } catch (caught) {
    return caught === original;
  }
}

export function throughFinally(): void {
  try {
    nested();
  } finally {
    normal(3);
  }
}

export function captureFinally(): string {
  const depth = stackDepth();
  let trace = "";
  xpcall(throughFinally, (error: unknown) => { trace = traceback(error); });
  restoreStack(depth);
  return trace;
}

export function nextFailure(): void {
  throw new Error("next failure");
}

export function afterCatch(): string {
  caught();
  let trace = "";
  const depth = stackDepth();
  xpcall(nextFailure, (error: unknown) => { trace = traceback(error); });
  restoreStack(depth);
  return trace;
}
