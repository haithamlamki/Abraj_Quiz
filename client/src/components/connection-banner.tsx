import { useTranslation } from "react-i18next";
import type { ConnectionStatus } from "@/hooks/use-game-websocket";

// Fixed top-of-viewport strip so it is visible over any quiz theme. Initial
// "connecting" is silent — the banner only appears when something is wrong.
export function ConnectionBanner({ status }: { status: ConnectionStatus }) {
  const { t } = useTranslation();
  if (status === "open" || status === "connecting") return null;

  const failed = status === "failed";
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connection-banner"
      className={`fixed inset-x-0 top-0 z-50 px-4 py-2 text-center text-sm font-semibold text-white shadow-md ${
        failed ? "bg-red-600" : "bg-amber-500 animate-pulse"
      }`}
    >
      {failed ? t("common.connectionLost") : t("common.reconnecting")}
    </div>
  );
}
