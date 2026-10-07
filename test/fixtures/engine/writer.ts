// A process that prints a buffer's address, then writes to it every 10 ms: a target for stopWatch.
import { ptr } from "bun:ffi";
const counter = new Int32Array(16);
console.log(ptr(counter));
setInterval(() => { counter[0] = (counter[0] ?? 0) + 1; }, 10);
setTimeout(() => process.exit(0), 2500);
