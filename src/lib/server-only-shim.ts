if (typeof window !== "undefined") {
  throw new Error("Server-only module imported in the browser. This would leak secrets.");
}
export {};
