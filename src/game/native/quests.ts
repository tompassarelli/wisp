import type { Handle, HandleFactory } from "./types";

export interface QuestEntry {
  title: string;
  description: string;
  iconPath: string;
  required: boolean;
  discovered: boolean;
  completed: boolean;
}

/** The quest log a game fills with `createQuest`; a headless test reads `entries()` where Warcraft would draw the log. */
export class Quests {
  private readonly log = new Map<Handle, QuestEntry>();

  constructor(private readonly handle: HandleFactory) {}

  create(): Handle {
    const quest = this.handle("quest");
    this.log.set(quest, { title: "", description: "", iconPath: "", required: false, discovered: false, completed: false });
    return quest;
  }

  entry(quest: Handle): QuestEntry | undefined {
    return this.log.get(quest);
  }

  entries(): readonly QuestEntry[] {
    return [...this.log.values()];
  }
}
