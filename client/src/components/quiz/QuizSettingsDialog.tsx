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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Quiz settings</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500">Title</label>
            <Input value={title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Quiz title" />
          </div>
          <div>
            <label className="text-xs text-gray-500">Description</label>
            <Textarea value={description} onChange={(e) => onChange({ description: e.target.value })} rows={3} placeholder="Optional description" />
          </div>
          <div>
            <label className="text-xs text-gray-500">Visibility</label>
            <Select value={isPublic ? "public" : "private"} onValueChange={(v) => onChange({ isPublic: v === "public" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public — anyone can host</SelectItem>
                <SelectItem value="private">Private — only you</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
