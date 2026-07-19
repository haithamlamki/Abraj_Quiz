import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { setAuthToken } from "@/lib/authToken";
import { apiRequest } from "@/lib/queryClient";
import { useTenant } from "@/lib/tenant";

export default function Login() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const tenant = useTenant();
  const [formData, setFormData] = useState({
    username: "",
    password: ""
  });

  const loginMutation = useMutation({
    mutationFn: async (data: { username: string; password: string }) => {
      const response = await apiRequest("POST", "/api/login", data);
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data?.token) setAuthToken(data.token);
      // Clear any cached data from a previously-signed-in user on this browser
      // before loading this user's views.
      queryClient.clear();
      toast({
        title: t("auth.loginSuccessTitle"),
        description: t("auth.loginSuccessDescription"),
      });
      setLocation("/");
    },
    onError: (error: any) => {
      toast({
        title: t("auth.loginFailedTitle"),
        description: error.message || t("auth.loginFailedDefault"),
        variant: "destructive",
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.username || !formData.password) {
      toast({
        title: t("auth.missingInfoTitle"),
        description: t("auth.missingCredentials"),
        variant: "destructive",
      });
      return;
    }
    loginMutation.mutate(formData);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  return (
    <div className="page-fill animate-gradient bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md card-3d-enhanced glass animate-scale-in">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold gradient-text">
            {t("auth.loginTitle")}
          </CardTitle>
          <p className="text-gray-600">{t("auth.loginSubtitle", { appName: tenant.branding.appName })}</p>
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
                placeholder={t("auth.usernamePlaceholder")}
                disabled={loginMutation.isPending}
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
                placeholder={t("auth.passwordPlaceholder")}
                disabled={loginMutation.isPending}
                data-testid="input-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loginMutation.isPending}
              data-testid="button-signin"
            >
              {loginMutation.isPending ? t("auth.signingIn") : t("auth.signIn")}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <p className="text-sm text-gray-600">
              {t("auth.noAccount")}{" "}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation("/signup")}
                className="text-primary hover:underline p-0 h-auto font-normal"
              >
                {t("auth.signUpHere")}
              </Button>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}