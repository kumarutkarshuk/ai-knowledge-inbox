import { LoaderCircle } from "lucide-react";
import { Outlet } from "react-router";
import { SERVER_WAKING_HINT } from "@/constants";
import { useServerWaking } from "@/lib/serverWaking";

function ServerWakingHint() {
  if (!useServerWaking()) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-(--z-toast) flex justify-center px-4">
      <p
        role="status"
        className="flex items-center gap-2 border-y border-rule-strong bg-well px-4 py-2 text-sm text-foreground"
      >
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
        {SERVER_WAKING_HINT}
      </p>
    </div>
  );
}

export function Root() {
  return (
    <>
      <Outlet />
      <ServerWakingHint />
    </>
  );
}
