import { convert } from "html-to-text";

export type NormalizedInboundEmail = {
  provider: string;
  sourceMessageId: string;
  originalMessageId: string | null;
  sender: string;
  recipient: string;
  subject: string;
  receivedAt: string;
  sentAt: string | null;
  text: string;
  html: string;
  normalizedText: string;
  deliveryAuthenticated: boolean;
  forwarded: boolean;
};

export function normalizeEmailText(text: string, html: string): string {
  // The maintained DOM converter handles entities, table cells, links and malformed HTML.
  const body = text.trim() || convert(html, {
    wordwrap: false,
    selectors: [{ selector: "a", options: { hideLinkHrefIfSameAsText: true } }],
    limits: { maxInputLength: 128_000, maxDepth: 30, maxChildNodes: 5000 },
  });
  return body.normalize("NFKC").replace(/\r\n?/g, "\n").replace(/[\t\u00a0]+/g, " ").trim();
}
