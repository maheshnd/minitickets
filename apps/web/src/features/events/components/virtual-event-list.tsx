"use client";

import { useState, type UIEvent } from "react";
import type { Event } from "@minitickets/shared";
import { EventCard } from "./event-card";

const ROW_HEIGHT = 208;
const VIEWPORT = 624;
const OVERSCAN = 3;

export function VirtualEventList({ items, onEnd }: { items: Event[]; onEnd: () => void }) {
  const [top, setTop] = useState(0);
  // 1. Small lists keep their natural height. Large lists mount only visible rows + overscan.
  const virtual = items.length > 20;
  const start = virtual ? Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN) : 0;
  const end = virtual ? Math.min(items.length, Math.ceil((top + VIEWPORT) / ROW_HEIGHT) + OVERSCAN) : items.length;
  function scroll(event: UIEvent<HTMLDivElement>) {
    setTop(event.currentTarget.scrollTop);
    if (event.currentTarget.scrollTop + VIEWPORT >= items.length * ROW_HEIGHT - ROW_HEIGHT * 3) onEnd();
  }
  return (
    <div onScroll={scroll} tabIndex={virtual ? 0 : undefined}
      aria-label="Event results" role="region"
      style={virtual ? { height: VIEWPORT, overflowY: "auto", overflowAnchor: "none" } : undefined}>
      <ul className={virtual ? "relative" : "space-y-4"}
        style={virtual ? { height: items.length * ROW_HEIGHT } : undefined}>
        {items.slice(start, end).map((event, offset) => (
          <EventCard key={event.id} event={event}
            position={virtual ? { top: (start + offset) * ROW_HEIGHT, index: start + offset, total: items.length } : undefined} />
        ))}
      </ul>
    </div>
  );
}
