import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}

/** In-page error surface (NOT the root error boundary — that stays hardcoded English). */
export function ErrorState({ title, description, onRetry, className }: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-16 px-6 gap-3",
        className,
      )}
      role="alert"
    >
      <h3 className="text-lg font-semibold text-foreground">
        {title ?? t("common.error.title")}
      </h3>
      {description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          {t("common.error.retry")}
        </Button>
      ) : null}
    </div>
  );
}
