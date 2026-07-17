import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface QuizSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  isPublic: boolean;
  onChange: (patch: { title?: string; description?: string; isPublic?: boolean }) => void;
}

export function QuizSettingsDialog({ open, onOpenChange, title, description, isPublic, onChange }: QuizSettingsDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t("editor.settings.dialogTitle")}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500">{t("editor.settings.titleLabel")}</label>
            <Input value={title} onChange={(e) => onChange({ title: e.target.value })} placeholder={t("editor.settings.titlePlaceholder")} />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t("editor.settings.descriptionLabel")}</label>
            <Textarea value={description} onChange={(e) => onChange({ description: e.target.value })} rows={3} placeholder={t("editor.settings.descriptionPlaceholder")} />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t("editor.settings.visibilityLabel")}</label>
            <Select value={isPublic ? "public" : "private"} onValueChange={(v) => onChange({ isPublic: v === "public" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="public">{t("editor.settings.visibilityPublic")}</SelectItem>
                <SelectItem value="private">{t("editor.settings.visibilityPrivate")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
