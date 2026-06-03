// Minimal DOM interface used by content-script page-context utilities.
// Kept free of browser globals so helpers can be unit-tested in Node.

export interface DocLike {
  querySelector(selector: string): { textContent: string | null; getAttribute(name: string): string | null } | null;
  title: string;
}
