/**
 * Identity file loader for the Tachikoma agent.
 *
 * Reads `~/.0xkobold/{IDENTITY,USER,SOUL}.md`, hashes them, caches the joined content.
 * Re-reads on hash change so edits to the underlying files propagate to the LLM.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { getSession, setIdentityCache } from "./state.js";
import type { IdentitySnapshot } from "./types.js";

const IDENTITY_DIR = join(homedir(), ".0xkobold");
const FILES = ["IDENTITY.md", "USER.md", "SOUL.md"] as const;
type FileKey = (typeof FILES)[number];

function filePath(name: string): string {
  return join(IDENTITY_DIR, name);
}

function hashOf(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function readFileSafe(path: string): { content: string; hash: string } | null {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf8");
  return { content, hash: hashOf(content) };
}

/**
 * Read all three identity files. Returns null if NONE are present (so the
 * extension can skip the `<identity-config>` block instead of emitting empty).
 */
export function loadIdentitySnapshot(): IdentitySnapshot | null {
  const files = {
    identity: readFileSafe(filePath(FILES[0])),
    user: readFileSafe(filePath(FILES[1])),
    soul: readFileSafe(filePath(FILES[2])),
  };

  // If all three are missing, we have nothing to inject.
  if (!files.identity && !files.user && !files.soul) return null;

  const identityContent = files.identity
    ? `## ${FILES[0]}\n\n${files.identity.content}`
    : `## ${FILES[0]}\n\n(file not found at ${IDENTITY_DIR})`;
  const userContent = files.user
    ? `## ${FILES[1]}\n\n${files.user.content}`
    : `## ${FILES[1]}\n\n(file not found at ${IDENTITY_DIR})`;
  const soulContent = files.soul
    ? `## ${FILES[2]}\n\n${files.soul.content}`
    : `## ${FILES[2]}\n\n(file not found at ${IDENTITY_DIR})`;

  const joined = [identityContent, userContent, soulContent].join("\n\n");

  // Combined hash of all three — only re-joined when something actually changes.
  const combinedHash =
    [files.identity?.hash ?? "0", files.user?.hash ?? "0", files.soul?.hash ?? "0"].join(
      ".",
    );

  return {
    hash: combinedHash,
    content: joined,
    files: {
      identity: {
        path: filePath(FILES[0]),
        hash: files.identity?.hash ?? "",
        content: files.identity?.content ?? "",
      },
      user: {
        path: filePath(FILES[1]),
        hash: files.user?.hash ?? "",
        content: files.user?.content ?? "",
      },
      soul: {
        path: filePath(FILES[2]),
        hash: files.soul?.hash ?? "",
        content: files.soul?.content ?? "",
      },
    },
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Get the cached identity block. Refreshes the cache if the underlying files
 * have changed (or no cache exists).
 *
 * Returns null if the files can't be read.
 */
export function getIdentityBlock(): string | null {
  const snap = loadIdentitySnapshot();
  if (!snap) return null;
  const s = getSession();
  if (snap.hash !== s.identityHash) {
    setIdentityCache(snap.hash, snap.content);
  }
  return snap.content;
}

/**
 * Force an unconditional re-read. Use after a file change is detected externally
 * (e.g., AGENTS.md watcher signal) instead of waiting for the next getIdentityBlock.
 */
export function refreshIdentityBlock(): string | null {
  const snap = loadIdentitySnapshot();
  if (!snap) return null;
  setIdentityCache(snap.hash, snap.content);
  return snap.content;
}
