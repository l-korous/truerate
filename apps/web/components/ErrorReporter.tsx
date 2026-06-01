"use client";

import { useEffect } from "react";
import { installGlobalHandlers } from "../lib/error-reporter";

/** Mounts global unhandledrejection / error listeners once per page load. */
export function ErrorReporter() {
  useEffect(() => {
    installGlobalHandlers();
  }, []);
  return null;
}
