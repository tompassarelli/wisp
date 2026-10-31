export type Frame = framehandle;
export type Events = trigger;
export type Player = player;
export type Quest = quest;
export type FramePoint = framepointtype;
export type FrameEvent = frameeventtype;
export type TextAlignment = textaligntype;
export type OriginFrame = originframetype;
export type FrameKind = "BACKDROP" | "BUTTON" | "CHECKBOX" | "EDITBOX" | "FRAME" | "GLUEBUTTON" | "GLUETEXTBUTTON" | "HIGHLIGHT" | "SCROLLBAR" | "SLIDER" | "SPRITE" | "TEXT" | "TEXTAREA";

export declare function createFrame(template: string, owner: Frame, priority: number, context: number): Frame;
export declare function createFrameByType(kind: FrameKind, name: string, owner: Frame, inherits: string, context: number): Frame;
export declare function destroyFrame(frame: Frame): void;
export declare function clearFramePoints(frame: Frame): void;
export declare function frameChild(frame: Frame, index: number): Frame;
export declare function frameChildCount(frame: Frame): number;

/** @local */
export declare function frameEnabled(frame: Frame): boolean;
export declare function frameName(frame: Frame): string;

/** @local */
export declare function frameText(frame: Frame): string;
export declare function frameTextLimit(frame: Frame): number;

/** @local */
export declare function frameVisible(frame: Frame): boolean;
export declare function setFrameAbsPoint(frame: Frame, point: FramePoint, x: number, y: number): void;
export declare function setFrameAlpha(frame: Frame, alpha: number): void;
export declare function setFrameEnabled(frame: Frame, enabled: boolean): void;
export declare function setFrameFocus(frame: Frame, focused: boolean): void;
export declare function setFrameFont(frame: Frame, file: string, height: number, flags: number): void;
export declare function setFrameLevel(frame: Frame, level: number): void;
export declare function setFramePoint(frame: Frame, point: FramePoint, relative: Frame, relativePoint: FramePoint, x: number, y: number): void;
export declare function setFrameScale(frame: Frame, scale: number): void;
export declare function setFrameSize(frame: Frame, width: number, height: number): void;
export declare function setFrameText(frame: Frame, text: string): void;
export declare function setFrameTextAlignment(frame: Frame, vertical: TextAlignment, horizontal: TextAlignment): void;
export declare function setFrameTextLimit(frame: Frame, limit: number): void;
export declare function setFrameTexture(frame: Frame, file: string, flag: number, blend: boolean): void;
export declare function setFrameColor(frame: Frame, color: number): void;
export declare function setFrameVisible(frame: Frame, visible: boolean): void;
export declare function namedFrame(name: string, context: number): Frame;

/** @local */
export declare function screenHeight(): number;

/** @local */
export declare function screenWidth(): number;
export declare function originFrame(origin: OriginFrame, index: number): Frame;
export declare function eventFrame(): Frame;
export declare function eventFrameEvent(): FrameEvent;
export declare function eventFrameText(): string;
export declare function hideOriginFrames(hide: boolean): void;
export declare function loadFrameFile(path: string): boolean;
export declare function frameColor(alpha: number, red: number, green: number, blue: number): number;
export declare function addFrameEvent(events: Events, frame: Frame, event: FrameEvent): void;
export declare function displayText(player: Player, x: number, y: number, message: string): void;
export declare function displayTimedText(player: Player, x: number, y: number, seconds: number, message: string): void;
export declare function clearTextMessages(): void;
export declare function debugMessage(message: string): void;
export declare function createQuest(): Quest;
export declare function setQuestTitle(quest: Quest, title: string): void;
export declare function setQuestDescription(quest: Quest, description: string): void;
export declare function setQuestIcon(quest: Quest, path: string): void;
export declare function setQuestRequired(quest: Quest, required: boolean): void;
export declare function setQuestDiscovered(quest: Quest, discovered: boolean): void;
export declare function setQuestCompleted(quest: Quest, completed: boolean): void;
