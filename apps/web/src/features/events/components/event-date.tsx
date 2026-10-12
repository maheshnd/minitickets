"use client";

import { useSyncExternalStore } from "react";

// @concept: hydration
// The start time of an event. The database stores it in UTC.
//
// 1. The problem: the server and the browser can be in different timezones (an AWS server runs in
//    UTC, the visitor might be in Paris) and use different languages. If both formatted the date
//    "in their own timezone", the server HTML would say 6:30 PM and the browser 7:30 PM. React
//    compares them while hydrating, finds a mismatch, and throws the server HTML away.
// 2. The fix: the server (and the browser's FIRST render, during hydration) use one fixed format:
//    English, UTC, with "UTC" written after it, so it is never wrong, only less local.
//    Right after hydration the browser renders again with the viewer's own timezone and language.
const fixedFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: "UTC" });
const viewerFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });

// 3. useSyncExternalStore is React's tool for "a value that differs between server and browser".
//    getServerSnapshot (false) is used on the server and during hydration; getSnapshot (true)
//    afterwards. Nothing ever changes later, so subscribe does nothing.
const subscribe = () => () => {};
const inBrowser = () => true;
const onServerOrHydrating = () => false;

export function EventDate({ iso }: { iso: string }) {
  const local = useSyncExternalStore(subscribe, inBrowser, onServerOrHydrating);
  const date = new Date(iso);
  return <time dateTime={iso}>{local ? viewerFormat.format(date) : `${fixedFormat.format(date)} UTC`}</time>;
}
