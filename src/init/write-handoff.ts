import { discover as discoverStack } from "../adapter/discover/index.js";
import { CONFORMANCE_RECORD_PATH, DECISION_LOG_PATH } from "../schemas/pack.js";
import { readDecisionLog } from "./decide-log.js";
import { discoverDocs } from "./discover-docs.js";
import { contentsDigest, listingDigest, valueDigest, type PhaseOutcome } from "./machine.js";
import { packDocuments } from "./pack.js";

/**
 * C-2¹³, C-2¹⁴ (PRDR-283, PRDR-284) — what WRITE and VALIDATE hand the
 * planning phases, and the key each is looked up under, read from the disk.
 * Moved out of `write.ts` when PRDR-341 took it past 300 lines.
 */

type Json = Record<string, unknown>;

/**
 * What the planning phases read, from the disk, whether the phase handing it
 * on wrote or not: the documents DISCOVER's patterns find now, the decision
 * log among them where it exists, the stack markers, and the log's entries.
 * VALIDATE hands it on, as the specification phase's last step (C-2¹⁴);
 * WRITE's is what planning reads where VALIDATE is not in the pipeline.
 */
export function handoff(root: string, patterns: readonly string[], run: Json): PhaseOutcome {
  const log = readDecisionLog(root);
  const found = discoverDocs(root, patterns).docs.filter((doc) => doc !== DECISION_LOG_PATH);
  return {
    kind: "complete",
    outputs: {
      docs: log.exists ? [...found, DECISION_LOG_PATH].sort() : found,
      stack_markers: [...discoverStack(root).stack.markers],
      decisions: log.decisions,
      defaults: log.defaults,
      ...run,
    },
  };
}

/**
 * C-2¹³, C-2¹⁴: everything WRITE's and VALIDATE's outputs say, read from the
 * disk alone, as a phase that restarts the chain must: the documents and stack
 * markers DISCOVER's patterns find, the pack's contents and its record, whose
 * kind decides whether either writes, and `plan_docs`. Never a prompt: once
 * the pack is written or validated, a new prompt writes nothing, and a key
 * that named it would re-plan every pack on an upgrade. Never VALIDATE's
 * ceiling, which bounds a validation and never reopens a finished one.
 */
export function packDigest(root: string, patterns: readonly string[], planDocs: readonly string[] | undefined): string {
  const markers = discoverStack(root).stack.markers.map((m) => `marker:${m}`);
  return [
    listingDigest([...discoverDocs(root, patterns).docs, ...markers]),
    contentsDigest(root, [...packDocuments(root), CONFORMANCE_RECORD_PATH]),
    valueDigest(planDocs ?? []),
  ].join("|");
}

/** C-2¹³, C-2¹⁴: the stack markers the planning phases read: VALIDATE's, or WRITE's or DISCOVER's where it is not in the pipeline. */
export function planningMarkers(outputs: Readonly<Record<string, Record<string, unknown>>>): string[] {
  const markers = outputs["VALIDATE"]?.["stack_markers"] ?? outputs["WRITE"]?.["stack_markers"] ?? outputs["DISCOVER"]?.["stack_markers"];
  return Array.isArray(markers) ? (markers as string[]) : [];
}
