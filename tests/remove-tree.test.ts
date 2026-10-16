import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { removeTree, tmpTree } from "./helpers.js";

/**
 * A child that writes a new file into `root` in a tight loop for 300 ms, after
 * a `started` marker, as a process a test left running would.
 */
const WRITER = `
const fs = require("node:fs");
const root = process.argv[1];
fs.writeFileSync(root + "/started", "");
const end = Date.now() + 300;
for (let i = 0; Date.now() < end; i += 1) fs.writeFileSync(root + "/f-" + i, "x");
`;

describe("#35: removeTree", () => {
  it("removes a tree another process is still writing into, rather than failing with ENOTEMPTY", async () => {
    const root = tmpTree();
    const writer = spawn(process.execPath, ["-e", WRITER, root], { stdio: "ignore" });
    const exited = once(writer, "exit");
    while (!existsSync(path.join(root, "started"))) await new Promise((resolve) => setTimeout(resolve, 5));

    removeTree(root);
    await exited;

    expect(existsSync(root)).toBe(false);
  });
});
