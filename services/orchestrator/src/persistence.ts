import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ArtifactRecord, JsonValue, SessionEvent, SessionEventType } from "@opengravity/shared-types";
import type { SessionSnapshot } from "@opengravity/session-core";

import { InMemorySessionStore, type PersistedSessionRecord } from "./core.js";

export class JsonFileSessionStore extends InMemorySessionStore {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    super();
    this.baseDir = baseDir;
    mkdirSync(this.baseDir, { recursive: true });
    this.loadExisting();
  }

  override save(sessionId: string, snapshot: SessionSnapshot): void {
    super.save(sessionId, snapshot);
    this.flush(sessionId);
  }

  override appendEvent(
    sessionId: string,
    input: {
      type: SessionEventType;
      message: string;
      taskId?: string;
      agentId?: string;
      modelId?: string;
      metadata?: JsonValue;
    }
  ): SessionEvent {
    const event = super.appendEvent(sessionId, input);
    this.flush(sessionId);
    return event;
  }

  override addArtifact(
    sessionId: string,
    input: {
      kind: ArtifactRecord["kind"];
      title: string;
      contentSummary: string;
      taskId?: string;
      path?: string;
      metadata?: JsonValue;
    }
  ): ArtifactRecord {
    const artifact = super.addArtifact(sessionId, input);
    this.flush(sessionId);
    return artifact;
  }

  private loadExisting(): void {
    for (const entry of readdirSync(this.baseDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const filePath = join(this.baseDir, entry.name);
      const record = JSON.parse(readFileSync(filePath, "utf8")) as PersistedSessionRecord;
      if (record.sessionId) {
        super.restoreRecord({
          sessionId: record.sessionId,
          snapshot: record.snapshot,
          events: record.events ?? [],
          artifacts: record.artifacts ?? []
        });
      }
    }
  }

  private flush(sessionId: string): void {
    const record = this.getRecord(sessionId);
    if (!record) {
      return;
    }

    writeFileSync(
      join(this.baseDir, `${sanitizeSessionId(sessionId)}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8"
    );
  }
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
