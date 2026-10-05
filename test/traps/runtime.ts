// Map code runs in Warcraft's Lua: no host APIs and nothing nondeterministic.
import { readFileSync } from "node:fs"; // rejected

export const file = Bun.file("x"); // rejected
export const args = process.argv; // rejected
export const title = document.title; // rejected
export const bytes = readFileSync("x");
export const roll = Math.random(); // rejected
export const now = Date.now(); // rejected
export const text = JSON.stringify({}); // rejected
export const larger = Math.max(1, 2);
