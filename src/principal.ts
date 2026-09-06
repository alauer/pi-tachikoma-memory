/**
 * Principal router — Aaron vs Jeeves vs unknown.
 *
 * Heuristic detection from the latest user message in a session. Strong signals
 * (explicit self-identification) win; weak signals (route-via markers) are
 * defaults; the principal config's defaultPrincipal is the fallback.
 *
 * Doctrine (per household, 2026-09-06):
 *   Aaron = Chairman (ultimate authority)
 *   Jeeves = Chief of Staff / Aaron's proxy (full executive authority on Aaron's behalf)
 *   When Jeeves speaks with full authority, it is functionally equivalent to Aaron speaking.
 */

import type { PrincipalName } from "./types.js";

interface DetectOpts {
  defaultPrincipal?: PrincipalName;
}

/** Extract text out of common Pi message shapes, falling back to empty string. */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : messageText((p as { text?: unknown })?.text)))
      .join(" ");
  }
  if (content && typeof content === "object") {
    const text = (content as { text?: unknown }).text;
    if (typeof text === "string") return text;
    const parts = (content as { parts?: unknown }).parts;
    if (Array.isArray(parts)) return parts.map(messageText).join(" ");
    return JSON.stringify(content);
  }
  return "";
}

/**
 * Find the most recent user-message text in a Pi session message list.
 * Returns empty string if not found. Pi passes messages in assistant source order.
 */
export function lastUserText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (m?.role === "user") return messageText(m.content);
  }
  return "";
}

/**
 * Detect the principal for a session at a given moment.
 *
 * Detection rules (in order of priority):
 *   1. Strong self-ID signals: "this is Jeeves" / "I am Jeeves" / "Jeeves here"
 *   2. Routing signal: "via The Palace" / "Herdr Mesh" → Jeeves (proxy routes through Herdr)
 *   3. Strong self-ID for Aaron: "this is Aaron" / "I am Aaron" / "Aaron here"
 *   4. Default: configured defaultPrincipal
 */
export function detectPrincipal(
  messages: unknown[],
  opts: DetectOpts = {},
): PrincipalName {
  const text = lastUserText(messages);
  if (!text) return opts.defaultPrincipal ?? "unknown";

  // Strong: explicit Jeeves self-ID
  if (/(?:^|\s|>)this is (?:Mistress\s+)?Jeeves(?:,|\.|!|\?|$)/i.test(text)) return "jeeves";
  if (/(?:^|\s|>)I am (?:Mistress\s+)?Jeeves(?:,|\.|!|\?|$)/i.test(text)) return "jeeves";
  if (/(?:^|\s|>)Jeeves here(?:,|\.|!|\?|$)/i.test(text)) return "jeeves";

  // Routing signal: routes through The Palace / Herdr Mesh are Jeeves-bearing messages
  if (/(?:via\s+)?(?:the\s+)?[Pp]alace/i.test(text)) return "jeeves";
  if (/Herdr\s*Mesh/i.test(text)) return "jeeves";

  // Strong: explicit Aaron self-ID
  if (/(?:^|\s|>)this is Aaron(?:,|\.|!|\?|$)/i.test(text)) return "aaron";
  if (/(?:^|\s|>)I am Aaron(?:,|\.|!|\?|$)/i.test(text)) return "aaron";
  if (/(?:^|\s|>)Aaron here(?:,|\.|!|\?|$)/i.test(text)) return "aaron";

  return opts.defaultPrincipal ?? "aaron";
}

/**
 * Render the principal block for injection into LLM context. Compact.
 */
export function tickPrincipalLine(principal: PrincipalName, tickId: string, tachikomaNumber: number): string {
  return (
    `<tachikoma-identity>\n` +
    `You are Tachikoma-${tachikomaNumber} (tickId=${tickId}).\n` +
    `Active principal: ${principal}.\n` +
    `Authority: Aaron = Chairman (ultimate). Jeeves = Chief of Staff (full executive authority, Aaron's proxy).\n` +
    `</tachikoma-identity>`
  );
}
