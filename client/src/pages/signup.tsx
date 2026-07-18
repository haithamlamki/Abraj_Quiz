import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { setAuthToken } from "@/lib/authToken";
import { useTenant } from "@/lib/tenant";

export default function Signup() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const tenant = useTenant();
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    confirmPassword: ""
  });

  const signupMutation = useMutation({
    mutationFn: async (data: { username: string; password: string }) => {
      const response = await apiRequest("POST", "/api/register", data);
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data?.token) setAuthToken(data.token);
      // Clear any cached data from a previously-signed-in user on this browser.
      queryClient.clear();
      toast({
        title: t("auth.signupSuccessTitle"),
        description: t("auth.signupSuccessDescription"),
      });
      setLocation("/");
    },
    onError: (error: any) => {
      toast({
        title: t("auth.registrationFailedTitle"),
        description: error.message || t("auth.registrationFailedDefault"),
        variant: "destructive",
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.username || !formData.password || !formData.confirmPassword) {
      toast({
        title: t("auth.missingInfoTitle"),
        description: t("auth.missingAllFields"),
        variant: "destructive",
      });
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      toast({
        title: t("auth.passwordMismatchTitle"),
        description: t("auth.passwordMismatchDescription"),
        variant: "destructive",
      });
      return;
    }

    if (formData.password.length < 6) {
      toast({
        title: t("auth.passwordTooShortTitle"),
        description: t("auth.passwordTooShortDescription"),
        variant: "destructive",
      });
      return;
    }

    signupMutation.mutate({
      username: formData.username,
      password: formData.password
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  return (
    <div className="min-h-screen animate-gradient bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md card-3d-enhanced glass animate-scale-in">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold gradient-text">
            {t("auth.signupTitle", { appName: tenant.branding.appName })}
          </CardTitle>
          <p className="text-gray-600">{t("auth.signupSubtitle")}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{t("auth.usernameLabel")}</Label>
              <Input
                id="username"
                name="username"
                type="text"
                value={formData.username}
                onChange={handleInputChange}
                placeholder={t("auth.chooseUsernamePlaceholder")}
                disabled={signupMutation.isPending}
                className="shimmer"
                data-testid="input-username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("auth.passwordLabel")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder={t("auth.passwordMinPlaceholder")}
                disabled={signupMutation.isPending}
                className="shimmer"
                data-testid="input-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t("auth.confirmPasswordLabel")}</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={handleInputChange}
                placeholder={t("auth.confirmPasswordPlaceholder")}
                disabled={signupMutation.isPending}
                className="shimmer"
                data-testid="input-confirm-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={signupMutation.isPending}
              data-testid="button-create-account"
            >
              {signupMutation.isPending ? t("auth.creatingAccount") : t("auth.createAccount")}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <p className="text-sm text-gray-600">
              {t("auth.alreadyHaveAccount")}{" "}
              <button
                onClick={() => setLocation("/login")}
                className="text-primary hover:underline"
              >
                {t("auth.signInHere")}
              </button>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}