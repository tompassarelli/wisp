import { describe, expect, test } from "bun:test";
import { MENUS_DEADLINE, reachedMenus } from "../host/lan/pool";

describe("pool client readiness", () => {
  test("[spec docs/lan.md] a pool client counts as ready only once it reports its login doors, which on 3.0.1 follow the intro cinematic, and a solo game's own screens before them don't count", () => {
    const screen = (name: string) => ({ message: "ScreenTransitionInfo", payload: { screen: name, type: "Screen" } });
    expect(MENUS_DEADLINE).toBe("5 minutes");
    expect(reachedMenus([])).toBe(false);
    expect(reachedMenus([{ message: "OnWebUILoad" }, screen("LOADING_SCREEN"), screen("DISABLED_SCREEN")])).toBe(false);
    expect(reachedMenus([{ message: "ScreenTransitionInfo" }, { message: "ScreenTransitionInfo", payload: "LOGIN_DOORS" }])).toBe(false);
    expect(reachedMenus([{ message: "OnWebUILoad" }, screen("LOGIN_DOORS"), { message: "ScreenTransitionInfo", payload: { screen: "ERROR", type: "Modal" } }])).toBe(true);
  });
});
