import { type Events, type FrameEvent, type FrameKind, type FramePoint, type Frame, type OriginFrame, type Quest, type TextAlignment } from "../frames";
import type { Player } from "../players";
import type { QuestEntry } from "./quests";
import { asHandle, fromHandle } from "./types";
import { boundWorld, type World } from "./world";

function questEntry(world: World, quest: Quest, change: (entry: QuestEntry) => void): void {
  const entry = world.quests.entry(asHandle(quest));
  if (entry !== undefined) change(entry);
}

function registerFrameEvent(world: World, events: Events, frame: Frame, event: FrameEvent): void {
  const trigger = asHandle(events);
  if (world.events.hasFrame(trigger, frame, event)) throw new Error("addFrameEvent: this frame already registers this event on these events");
  world.events.registerFrame(trigger, frame, event);
}

// A frame colour is a signed 32-bit JASS integer: alpha in the high byte.
function packColor(alpha: number, red: number, green: number, blue: number): number {
  const word = ((alpha * 256 + red) * 256 + green) * 256 + blue;
  return word >= 2147483648 ? word - 4294967296 : word;
}

export function createFrame(template: string, owner: Frame, priority: number, context: number): Frame {
  const world = boundWorld();
  world.log?.("BlzCreateFrame", [template, owner, priority, context]);
  return fromHandle<Frame>(world.frames.create(template, owner, context));
}

export function createFrameByType(kind: FrameKind, name: string, owner: Frame, inherits: string, context: number): Frame {
  const world = boundWorld();
  world.log?.("BlzCreateFrameByType", [kind, name, owner, inherits, context]);
  return fromHandle<Frame>(world.frames.createByType(kind, name, owner, inherits, context));
}

export function destroyFrame(frame: Frame): void {
  const world = boundWorld();
  world.log?.("BlzDestroyFrame", [frame]);
  world.frames.destroy(frame);
}

export function clearFramePoints(frame: Frame): void {
  const world = boundWorld();
  world.log?.("BlzFrameClearAllPoints", [frame]);
  world.frames.clearPoints(frame);
}

export function frameChild(frame: Frame, index: number): Frame {
  const world = boundWorld();
  world.log?.("BlzFrameGetChild", [frame, index]);
  return fromHandle<Frame>(world.frames.child(asHandle(frame), index));
}

export function frameChildCount(frame: Frame): number {
  const world = boundWorld();
  world.log?.("BlzFrameGetChildrenCount", [frame]);
  return world.frames.childCount(frame);
}

export function frameEnabled(frame: Frame): boolean {
  const world = boundWorld();
  world.log?.("BlzFrameGetEnable", [frame]);
  return world.frames.enabled(frame);
}

export function frameName(frame: Frame): string {
  const world = boundWorld();
  world.log?.("BlzFrameGetName", [frame]);
  return world.frames.name(frame);
}

export function frameText(frame: Frame): string {
  const world = boundWorld();
  world.log?.("BlzFrameGetText", [frame]);
  return world.frames.text(frame);
}

export function frameTextLimit(frame: Frame): number {
  const world = boundWorld();
  world.log?.("BlzFrameGetTextSizeLimit", [frame]);
  return world.frames.textLimit(frame);
}

export function frameVisible(frame: Frame): boolean {
  const world = boundWorld();
  world.log?.("BlzFrameIsVisible", [frame]);
  return world.frames.visible(frame);
}

export function setFrameAbsPoint(frame: Frame, point: FramePoint, x: number, y: number): void {
  const world = boundWorld();
  world.log?.("BlzFrameSetAbsPoint", [frame, point, x, y]);
  world.frames.setAbsPoint(frame, point, x, y);
}

export function setFrameAlpha(frame: Frame, alpha: number): void {
  const world = boundWorld();
  world.log?.("BlzFrameSetAlpha", [frame, alpha]);
  world.frames.setAlpha(frame, alpha);
}

export function setFrameEnabled(frame: Frame, enabled: boolean): void {
  const world = boundWorld();
  world.log?.("BlzFrameSetEnable", [frame, enabled]);
  world.frames.setEnabled(frame, enabled);
}

export function setFrameFocus(frame: Frame, focused: boolean): void {
  const world = boundWorld();
  world.log?.("BlzFrameSetFocus", [frame, focused]);
  world.frames.setFocus(frame, focused);
}

export function setFrameFont(frame: Frame, file: string, height: number, flags: number): void {
  const world = boundWorld();
  world.log?.("BlzFrameSetFont", [frame, file, height, flags]);
  world.frames.setFont(frame, file, height, flags);
}

export function setFrameLevel(frame: Frame, level: number): void {
  const world = boundWorld();
  world.log?.("BlzFrameSetLevel", [frame, level]);
  world.frames.setLevel(frame, level);
}

export function setFramePoint(frame: Frame, point: FramePoint, relative: Frame, relativePoint: FramePoint, x: number, y: number): void {
  const world = boundWorld();
  world.log?.("BlzFrameSetPoint", [frame, point, relative, relativePoint, x, y]);
  world.frames.setPoint(frame, point, relative, relativePoint, x, y);
}

export function setFrameScale(frame: Frame, scale: number): void {
  const world = boundWorld();
  world.log?.("BlzFrameSetScale", [frame, scale]);
  world.frames.setScale(frame, scale);
}

export function setFrameSize(frame: Frame, width: number, height: number): void {
  const world = boundWorld();
  world.log?.("BlzFrameSetSize", [frame, width, height]);
  world.frames.setSize(frame, width, height);
}

export function setFrameText(frame: Frame, text: string): void {
  const world = boundWorld();
  world.log?.("BlzFrameSetText", [frame, text]);
  world.frames.setText(frame, text);
}

export function setFrameTextAlignment(frame: Frame, vertical: TextAlignment, horizontal: TextAlignment): void {
  const world = boundWorld();
  world.log?.("BlzFrameSetTextAlignment", [frame, vertical, horizontal]);
  world.frames.setTextAlignment(frame, vertical, horizontal);
}

export function setFrameTextLimit(frame: Frame, limit: number): void {
  const world = boundWorld();
  world.log?.("BlzFrameSetTextSizeLimit", [frame, limit]);
  world.frames.setTextLimit(frame, limit);
}

export function setFrameTexture(frame: Frame, file: string, flag: number, blend: boolean): void {
  const world = boundWorld();
  world.log?.("BlzFrameSetTexture", [frame, file, flag, blend]);
  world.frames.setTexture(frame, file);
}

export function setFrameColor(frame: Frame, color: number): void {
  const world = boundWorld();
  world.log?.("BlzFrameSetVertexColor", [frame, color]);
  world.frames.setVertexColor(frame, color);
}

export function setFrameModel(frame: Frame, model: string, camera: number): void {
  const world = boundWorld();
  world.log?.("BlzFrameSetModel", [frame, model, camera]);
  world.frames.setModel(frame, model, camera);
}

export function setFrameSpriteAnimation(frame: Frame, animation: number, flags: number): void {
  const world = boundWorld();
  world.log?.("BlzFrameSetSpriteAnimate", [frame, animation, flags]);
  world.frames.setSpriteAnimation(frame, animation);
}

export function setFrameSpriteTime(frame: Frame, seconds: number): void {
  const world = boundWorld();
  world.log?.("WispFrameSetSpriteTime", [frame, seconds]);
  world.frames.setSpriteTime(frame, seconds);
}

export function setFrameVisible(frame: Frame, visible: boolean): void {
  const world = boundWorld();
  world.log?.("BlzFrameSetVisible", [frame, visible]);
  world.frames.setVisible(frame, visible);
}

export function namedFrame(name: string, context: number): Frame {
  const world = boundWorld();
  world.log?.("BlzGetFrameByName", [name, context]);
  return fromHandle<Frame>(world.frames.named(name, context));
}

export function screenHeight(): number {
  const world = boundWorld();
  world.log?.("BlzGetLocalClientHeight", []);
  return world.frames.screen.height;
}

export function screenWidth(): number {
  const world = boundWorld();
  world.log?.("BlzGetLocalClientWidth", []);
  return world.frames.screen.width;
}

export function originFrame(origin: OriginFrame, index: number): Frame {
  const world = boundWorld();
  world.log?.("BlzGetOriginFrame", [origin, index]);
  return fromHandle<Frame>(world.frames.originFrame(origin, index));
}

export function eventFrame(): Frame {
  const world = boundWorld();
  world.log?.("BlzGetTriggerFrame", []);
  return fromHandle<Frame>(asHandle(world.events.triggerFrame()));
}

export function eventFrameEvent(): FrameEvent {
  const world = boundWorld();
  world.log?.("BlzGetTriggerFrameEvent", []);
  return world.events.triggerFrameEvent() as FrameEvent;
}

export function eventFrameText(): string {
  const world = boundWorld();
  world.log?.("BlzGetTriggerFrameText", []);
  return world.events.triggerFrameText();
}

export function hideOriginFrames(hide: boolean): void {
  boundWorld().log?.("BlzHideOriginFrames", [hide]);
}

export function loadFrameFile(path: string): boolean {
  boundWorld().log?.("BlzLoadTOCFile", [path]);
  return true;
}

export function frameColor(alpha: number, red: number, green: number, blue: number): number {
  const world = boundWorld();
  world.log?.("BlzConvertColor", [alpha, red, green, blue]);
  return packColor(alpha, red, green, blue);
}

export function addFrameEvent(events: Events, frame: Frame, event: FrameEvent): void {
  const world = boundWorld();
  world.log?.("BlzTriggerRegisterFrameEvent", [events, frame, event]);
  registerFrameEvent(world, events, frame, event);
}

export function displayText(player: Player, x: number, y: number, message: string): void {
  const world = boundWorld();
  world.log?.("DisplayTextToPlayer", [player, x, y, message]);
  world.display(player, message);
}

export function displayTimedText(player: Player, x: number, y: number, seconds: number, message: string): void {
  const world = boundWorld();
  world.log?.("DisplayTimedTextToPlayer", [player, x, y, seconds, message]);
  world.display(player, message);
}

export function clearTextMessages(): void {
  boundWorld().log?.("ClearTextMessages", []);
}

export function debugMessage(message: string): void {
  boundWorld().log?.("BJDebugMsg", [message]);
}

export function createQuest(): Quest {
  const world = boundWorld();
  world.log?.("CreateQuest", []);
  return fromHandle<Quest>(world.quests.create());
}

export function setQuestTitle(quest: Quest, title: string): void {
  const world = boundWorld();
  world.log?.("QuestSetTitle", [quest, title]);
  questEntry(world, quest, entry => { entry.title = title; });
}

export function setQuestDescription(quest: Quest, description: string): void {
  const world = boundWorld();
  world.log?.("QuestSetDescription", [quest, description]);
  questEntry(world, quest, entry => { entry.description = description; });
}

export function setQuestIcon(quest: Quest, path: string): void {
  const world = boundWorld();
  world.log?.("QuestSetIconPath", [quest, path]);
  questEntry(world, quest, entry => { entry.iconPath = path; });
}

export function setQuestRequired(quest: Quest, required: boolean): void {
  const world = boundWorld();
  world.log?.("QuestSetRequired", [quest, required]);
  questEntry(world, quest, entry => { entry.required = required; });
}

export function setQuestDiscovered(quest: Quest, discovered: boolean): void {
  const world = boundWorld();
  world.log?.("QuestSetDiscovered", [quest, discovered]);
  questEntry(world, quest, entry => { entry.discovered = discovered; });
}

export function setQuestCompleted(quest: Quest, completed: boolean): void {
  const world = boundWorld();
  world.log?.("QuestSetCompleted", [quest, completed]);
  questEntry(world, quest, entry => { entry.completed = completed; });
}

