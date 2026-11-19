import { useEffect, useRef } from "react";

const NEAR_BOTTOM_PX = 80;

function nearBottom(): boolean {
  return (
    window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - NEAR_BOTTOM_PX
  );
}

export function useFollowScroll(content: unknown) {
  const follow = useRef(true);

  useEffect(() => {
    let lastY = window.scrollY;
    function onScroll() {
      const y = window.scrollY;
      if (nearBottom()) follow.current = true;
      else if (y < lastY) follow.current = false;
      lastY = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!follow.current) return;
    const frame = requestAnimationFrame(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [content]);

  return {
    resume: () => {
      follow.current = true;
    },
  };
}
