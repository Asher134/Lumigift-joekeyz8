"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { Gift } from "@/types";
import { GiftCard } from "./GiftCard";
import styles from "./VirtualGiftList.module.css";

/** Mirrors the dashboard grid: `repeat(auto-fill, minmax(300px, 1fr))`. */
const MIN_CARD_WIDTH = 300;
const GAP = 24;
const ESTIMATED_ROW_HEIGHT = 220;

interface VirtualGiftListProps {
  gifts: Gift[];
  perspective: "sender" | "recipient";
}

/**
 * Window-virtualised gift grid (issue #350). Only rows near the viewport are
 * mounted; measured row heights are cached so scrolling back does not shift
 * layout. Column count follows the container width on resize.
 */
export function VirtualGiftList({ gifts, perspective }: VirtualGiftListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => {
      setColumns(Math.max(1, Math.floor((el.clientWidth + GAP) / (MIN_CARD_WIDTH + GAP))));
      setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rowCount = Math.ceil(gifts.length / columns);

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 3,
    gap: GAP,
    scrollMargin,
  });

  // Row contents change when the column count changes — re-measure.
  useEffect(() => {
    virtualizer.measure();
  }, [columns, virtualizer]);

  return (
    <div
      ref={listRef}
      role="list"
      aria-label={`${gifts.length} gift${gifts.length !== 1 ? "s" : ""}`}
      className={styles.list}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          className={styles.row}
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
          }}
        >
          {gifts.slice(row.index * columns, row.index * columns + columns).map((gift, i) => (
            <div
              key={gift.id}
              role="listitem"
              aria-setsize={gifts.length}
              aria-posinset={row.index * columns + i + 1}
            >
              <GiftCard gift={gift} perspective={perspective} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
