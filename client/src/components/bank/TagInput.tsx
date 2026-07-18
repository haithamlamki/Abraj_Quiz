import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  placeholder?: string;
}

// Chip input: Enter/comma adds the draft tag; suggestions (from bank meta)
// steer users toward existing tags to limit tag sprawl. Case-insensitive
// dedupe mirrors the server's normalizeTags.
export function TagInput({ value, onChange, suggestions, placeholder }: TagInputProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");

  const lower = useMemo(() => new Set(value.map((v) => v.toLowerCase())), [value]);
  const matches = useMemo(() => {
    const d = draft.trim().toLowerCase();
    return suggestions
      .filter((s) => !lower.has(s.toLowerCase()))
      .filter((s) => !d || s.toLowerCase().includes(d))
      .slice(0, 6);
  }, [draft, suggestions, lower]);

  const add = (raw: string) => {
    const tag = raw.trim();
    if (!tag || lower.has(tag.toLowerCase()) || value.length >= 20) return;
    onChange([...value, tag]);
    setDraft("");
  };

  const remove = (tag: string) => onChange(value.filter((v) => v !== tag));

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {value.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1">
            {tag}
            <button type="button" aria-label={t("bank.tagRemoveAria", { tag })} onClick={() => remove(tag)}>
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          }
        }}
        placeholder={placeholder ?? t("bank.tagsPlaceholder")}
        maxLength={50}
      />
      {matches.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {matches.map((s) => (
            <button key={s} type="button" className="text-xs text-abraj-primary underline" onClick={() => add(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
