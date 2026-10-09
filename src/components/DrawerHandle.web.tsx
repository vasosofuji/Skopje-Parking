import React, { useRef } from "react";
import type { DrawerHandleProps } from "./drawerHandleTypes";
export default function DrawerHandle(props: DrawerHandleProps) {
  const pointer = useRef<{ y: number; time: number; moved: boolean } | null>(
    null,
  );
  const ignoreClick = useRef(false);
  return (
    <button
      aria-label={props.label}
      aria-expanded={props.open}
      style={{
        height: 30,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: 0,
        cursor: "grab",
        touchAction: "none",
        userSelect: "none",
      }}
      onPointerDown={(event) => {
        pointer.current = { y: event.clientY, time: Date.now(), moved: false };
        ignoreClick.current = false;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = pointer.current;
        if (!start) return;
        const delta = event.clientY - start.y;
        if (!start.moved && Math.abs(delta) > 4) { start.moved = true; props.onStart(); }
        if (start.moved) props.onDrag(delta);
      }}
      onPointerUp={(event) => {
        const start = pointer.current;
        pointer.current = null;
        if (start?.moved) {
          ignoreClick.current = true;
          props.onEnd(
            (event.clientY - start.y) / Math.max(1, Date.now() - start.time),
          );
        } else if (start && Date.now() - start.time >= 400) ignoreClick.current = true;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        const moved = pointer.current?.moved;
        pointer.current = null;
        ignoreClick.current = true;
        if (moved) props.onEnd(0);
      }}
      onClick={() => {
        if (!ignoreClick.current) props.onToggle();
        ignoreClick.current = false;
      }}
    >
      <span
        style={{
          width: 36,
          height: 4,
          borderRadius: 8,
          opacity: 0.45,
          background: props.color,
        }}
      />
    </button>
  );
}
