import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/platform/fileio";

export function install(this: void): void {
  configureRuntime({ filePrefix: "dynamic-stock99", readyPrefix: "DS99_HRR", globalPrefix: "__dynamicStock99" });
}

export function start(this: void): void {
  install();
  const x = GetRectCenterX(bj_mapInitialPlayableArea);
  const y = GetRectCenterY(bj_mapInitialPlayableArea);
  const shop = CreateUnit(Player(PLAYER_NEUTRAL_PASSIVE), 1853057136, x, y, 270);
  UnitAddAbility(shop, 0x41737564);
  RemoveItemFromStock(shop, 1885889889);
  AddItemToStock(shop, 1885889889, 1, 1);
  AddUnitToStock(shop, 0x68666f6f, 1, 1);
  CreateUnit(Player(0), 0x4870616c, x + 128, y, 270);
  SetPlayerState(Player(0), PLAYER_STATE_RESOURCE_GOLD, 10000);
  SetPlayerState(Player(0), PLAYER_STATE_RESOURCE_LUMBER, 10000);
  SetPlayerState(Player(0), PLAYER_STATE_RESOURCE_FOOD_CAP, 100);
  SelectUnitForPlayerSingle(shop, Player(0));
  SetCameraPositionForPlayer(Player(0), x, y);
  const clock = CreateTimer();
  TimerStart(clock, 3600, false, () => DestroyTimer(clock));
  const rows = [
    "case=dynamic-stock99; shop=nshp; buyer=Hpal",
    "AddItemToStock=phea current=1 max=1",
    "AddUnitToStock=hfoo current=1 max=1; added shop ability=Asud",
    "native build, visible entries, hotkeys and restock observations must be recorded separately",
  ];
  const soldItem = CreateTrigger();
  TriggerRegisterUnitEvent(soldItem, shop, EVENT_UNIT_SELL_ITEM);
  TriggerAddAction(soldItem, () => {
    rows.push(`item-sale type=${GetItemTypeId(GetSoldItem())} timeMs=${R2I(TimerGetElapsed(clock) * 1000)}`);
    writeLines("dynamic-stock99.txt", rows);
  });
  const soldUnit = CreateTrigger();
  TriggerRegisterUnitEvent(soldUnit, shop, EVENT_UNIT_SELL);
  TriggerAddAction(soldUnit, () => {
    rows.push(`unit-sale type=${GetUnitTypeId(GetSoldUnit())} timeMs=${R2I(TimerGetElapsed(clock) * 1000)}`);
    writeLines("dynamic-stock99.txt", rows);
  });
  writeLines("dynamic-stock99.txt", rows);
  DisplayTextToPlayer(Player(0), 0, 0, "Dynamic stock #99: inspect phea and hfoo, purchase once, then record restock.");
}
