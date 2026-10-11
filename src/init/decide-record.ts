import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stateDir, writeArtifact } from "../fs/layout.js";
import { SCHEMA_VERSION, parseArtifact } from "../schemas/common.js";
import { decideRecordSchema, type DecideRecord } from "../schemas/decide.js";

/**
 * C-2¹² (PRDR-282) — DECIDE's own record, kept beside its checkpoint: which
 * entry of the log settled each item, and the last checked draft, so a run
 * whose items are still settled launches no session.
 */

/** Named apart from `DECIDE.json`, the checkpoint, which a case-insensitive file system would take for the same file. */
const RECORD = "state/decide-record.json";

/**
 * The record, or as much of it as this build reads. A draft an earlier build
 * wrote may lack what a draft now carries (PRDR-339's `basis`), and is only a
 * cache of a session's sorting: it is dropped, and the items it settled stay
 * settled, so no session runs again for them.
 */
export function readDecideRecord(root: string): DecideRecord {
  const empty: DecideRecord = { schema_version: SCHEMA_VERSION, settled: {}, draft: null };
  const file = path.join(stateDir(root), ...RECORD.split("/"));
  if (!existsSync(file)) return empty;
  try {
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    const parsed = parseArtifact(decideRecordSchema, raw);
    if (parsed.ok) return parsed.value;
    const settledOnly = parseArtifact(decideRecordSchema, { ...(raw as Record<string, unknown>), draft: null });
    return settledOnly.ok ? settledOnly.value : empty;
  } catch {
    return empty;
  }
}

export function writeDecideRecord(root: string, record: DecideRecord): void {
  writeArtifact(root, RECORD, record);
}
