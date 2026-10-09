import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/platform/fileio";
import { SHADOW_CONFIGS, SUBJECT_ID } from "./configs";

export function install(this: void): void {
  configureRuntime({ filePrefix: "shadow-strike94", readyPrefix: "SS94_HRR", globalPrefix: "__shadowStrike94" });
}

export function start(this: void): void {
  install();
  SetPlayerAlliance(Player(0), Player(1), ALLIANCE_PASSIVE, false);
  SetPlayerAlliance(Player(1), Player(0), ALLIANCE_PASSIVE, false);
  for (const config of SHADOW_CONFIGS) {
    const y = config.cast * 256;
    const caster = CreateUnit(Player(0), SUBJECT_ID, -128, y, 0);
    const target = CreateUnit(Player(1), SUBJECT_ID, 128, y, 180);
    SetWidgetLife(target, 1000);
    UnitAddAbility(caster, config.id);
    const rows = [`config=${config.name} level=1 acas=${config.cast} initial=40 periodic=10 duration=6`, "sample-unit=1/32-second damage-unit=1/256-life"];
    const clock = CreateTimer();
    const sampler = CreateTimer();
    let sample = 0;
    let previous = GetWidgetLife(target);
    TimerStart(clock, 9, false, () => {});
    TimerStart(sampler, 0.03125, true, () => {
      sample++;
      const life = GetWidgetLife(target);
      if (life !== previous) {
        rows.push(`change sample=${sample} elapsed-ms=${R2I(TimerGetElapsed(clock) * 1000)} damage256=${R2I((previous - life) * 256)} life256=${R2I(life * 256)}`);
        previous = life;
      }
      if (sample === 256) {
        rows.push(`end sample=${sample} life256=${R2I(life * 256)}`);
        PauseTimer(sampler);
        DestroyTimer(sampler);
        DestroyTimer(clock);
        writeLines(`shadow-strike94-${config.name}-p${GetPlayerId(GetLocalPlayer())}.txt`, rows);
        RemoveUnit(caster);
        RemoveUnit(target);
      }
    });
    rows.push(`order-accepted=${IssueTargetOrder(caster, "shadowstrike", target)}`);
  }
}
