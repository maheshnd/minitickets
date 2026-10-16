"use client";
import { useWebVitals } from "../hooks/use-web-vitals";
// 1. The hook owns reporting; the root layout only mounts this invisible feature component.
export function WebVitals() { useWebVitals(); return null; }
