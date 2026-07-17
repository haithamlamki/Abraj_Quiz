import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";

export interface PageLoaderProps {
  label?: string;
}

/** Full-height centered loader for route/page-level loading (Suspense, page fetches). */
export function PageLoader({ label }: PageLoaderProps) {
  const { t } = useTranslation();
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-4"
      role="status"
      aria-live="polite"
    >
      <Spinner size="lg" />
      <p className="text-lg text-muted-foreground">{label ?? t("common.loading")}</p>
    </div>
  );
}
