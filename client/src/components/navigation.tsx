import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/lib/tenant";
import { applyLanguage } from "@/lib/language";
import { PlusCircle, BookOpen, Gamepad2 } from "lucide-react";
import abrajLogo from "@assets/ABRJ.OM - Copy_1753085299475.png";

export default function Navigation() {
  const [location] = useLocation();
  const { user, isAuthenticated, logout, isLoggingOut } = useAuth();
  const tenant = useTenant();
  const { toast } = useToast();
  const { t, i18n } = useTranslation();

  return (
    <nav className="bg-white shadow-lg border-b-4 border-abraj-primary sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-4 rtl:space-x-reverse">
            <Link href="/">
              <div className="flex items-center space-x-3 rtl:space-x-reverse cursor-pointer">
                {(() => {
                  // Use the tenant's own logo; fall back to the bundled Abraj
                  // logo only for the Abraj tenant (its logoUrl is intentionally
                  // empty). Other tenants without a logo render a blank slot
                  // rather than flashing the Abraj mark.
                  const logoSrc =
                    tenant.branding.logoUrl || (tenant.slug === "abraj" ? abrajLogo : "");
                  return logoSrc ? (
                    <img
                      src={logoSrc}
                      alt={t("nav.logoAlt", { appName: tenant.branding.appName })}
                      className="w-10 h-10 object-contain"
                    />
                  ) : (
                    <div className="w-10 h-10" aria-hidden="true" />
                  );
                })()}
                <h1 className="font-bold text-2xl text-gray-800">{tenant.branding.appName}</h1>
              </div>
            </Link>
          </div>
          
          <div className="hidden md:block">
            <div className="ms-10 flex items-center space-x-6 rtl:space-x-reverse">
              <Link href="/create">
                <span className={`px-4 py-3 rounded-md text-lg font-medium transition-colors cursor-pointer flex items-center space-x-2 ${
                  location === '/create'
                    ? 'text-abraj-primary bg-teal-50'
                    : 'text-gray-700 hover:text-abraj-primary'
                }`}>
                  <PlusCircle className="w-8 h-8" />
                  <span>{t("nav.create")}</span>
                </span>
              </Link>
              {isAuthenticated && (
                <Link href="/my-quizzes">
                  <span className={`px-4 py-3 rounded-md text-lg font-medium transition-colors cursor-pointer flex items-center space-x-2 ${
                    location === '/my-quizzes'
                      ? 'text-abraj-primary bg-teal-50'
                      : 'text-gray-700 hover:text-abraj-primary'
                  }`}>
                    <BookOpen className="w-8 h-8" />
                    <span>{t("nav.myQuizzes")}</span>
                  </span>
                </Link>
              )}
              <Link href="/join">
                <span className={`px-4 py-3 rounded-md text-lg font-medium transition-colors cursor-pointer flex items-center space-x-2 ${
                  location.startsWith('/join')
                    ? 'text-abraj-primary bg-teal-50'
                    : 'text-gray-700 hover:text-abraj-primary'
                }`}>
                  <Gamepad2 className="w-8 h-8" />
                  <span>{t("nav.play")}</span>
                </span>
              </Link>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <Button
              variant="ghost"
              size="sm"
              data-testid="button-language-toggle"
              onClick={() => applyLanguage(i18n.language === "ar" ? "en" : "ar")}
            >
              {i18n.language === "ar" ? "EN" : "عربي"}
            </Button>
            {isAuthenticated ? (
              <>
                <span className="text-sm text-gray-600 hidden sm:block">
                  {t("nav.welcome")} <span className="font-medium text-abraj-primary">{user?.username}</span>
                </span>
                <Button
                  variant="outline"
                  className="font-medium"
                  onClick={() => {
                    logout();
                    toast({
                      title: t("nav.loggedOutTitle"),
                      description: t("nav.loggedOutDescription"),
                    });
                  }}
                  disabled={isLoggingOut}
                >
                  {isLoggingOut ? t("nav.loggingOut") : t("nav.logout")}
                </Button>
              </>
            ) : (
              <>
                <Link href="/signup">
                  <Button className="font-medium">
                    {t("nav.signup")}
                  </Button>
                </Link>
                <Link href="/login">
                  <Button
                    variant="outline"
                    className="font-medium"
                  >
                    {t("nav.login")}
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
