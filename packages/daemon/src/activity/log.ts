import { EventEmitter } from "node:events";

import type { ActivityEntry } from "@foreman/shared";

const MAX_ENTRIES = 500;

/**
 * In-memory ring buffer of recent packet activity.
 * Emits "entry" whenever a new ActivityEntry is added.
 */
export class ActivityLog extends EventEmitter {
  private entries: ActivityEntry[] = [];
  private seq = 0;

  add(entry: Omit<ActivityEntry, "id">): ActivityEntry {
    const full: ActivityEntry = { id: ++this.seq, ...entry };
    this.entries.push(full);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.emit("entry", full);
    return full;
  }

  snapshot(): ActivityEntry[] {
    return [...this.entries];
  }
}

export const activityLog = new ActivityLog();
