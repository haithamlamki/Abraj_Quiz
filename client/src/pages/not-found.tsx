import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  const { t } = useTranslation();

  return (
    <div className="page-fill w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-red-500" aria-hidden="true" />
          <h1 className="mt-4 text-2xl font-bold text-gray-900">
            {t("notFoundPage.title")}
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            {t("notFoundPage.description")}
          </p>
          <Link href="/">
            <Button className="mt-6" data-testid="button-not-found-home">
              {t("notFoundPage.goHome")}
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
