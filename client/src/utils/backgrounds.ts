// Utility functions for handling quiz background images and themes.
// A quiz `background` value can be:
//  - a full image URL (Supabase Storage https URL, or a legacy base64 data URL),
//  - a gradient preset id (see GRADIENT_THEMES), or
//  - an image theme id (see IMAGE_THEMES).

export interface ThemeOption {
  id: string;
  label: string;
  kind: "gradient" | "image";
  /** CSS value: a linear-gradient() for gradients, or an image path for images. */
  css: string;
}

export const GRADIENT_THEMES: ThemeOption[] = [
  { id: "aurora",   label: "Aurora",   kind: "gradient", css: "linear-gradient(135deg,#6d28d9 0%,#2563eb 50%,#0ea5e9 100%)" },
  { id: "sunset",   label: "Sunset",   kind: "gradient", css: "linear-gradient(135deg,#f97316 0%,#db2777 60%,#7c3aed 100%)" },
  { id: "mint",     label: "Mint",     kind: "gradient", css: "linear-gradient(135deg,#059669 0%,#14b8a6 55%,#22d3ee 100%)" },
  { id: "grape",    label: "Grape",    kind: "gradient", css: "linear-gradient(135deg,#7c3aed 0%,#c026d3 100%)" },
  { id: "ember",    label: "Ember",    kind: "gradient", css: "linear-gradient(135deg,#b91c1c 0%,#ea580c 55%,#f59e0b 100%)" },
  { id: "midnight", label: "Midnight", kind: "gradient", css: "linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#334155 100%)" },
];

// Every image theme id must have a matching asset in client/public/attached_assets/
// — an id without shipped art renders as a broken/dark tile.
export const IMAGE_THEMES: ThemeOption[] = [
  { id: "classroom", label: "Classroom", kind: "image", css: "/attached_assets/classroom-background.jpg" },
  { id: "classroom-cartoon", label: "Classroom Cartoon", kind: "image", css: "/attached_assets/classroom-cartoon.jpg" },
  { id: "classroom-board", label: "Chalkboard", kind: "image", css: "/attached_assets/classroom-board.jpg" },
  { id: "classroom-bright", label: "Bright Classroom", kind: "image", css: "/attached_assets/classroom-bright.jpg" },
];

export const PRESET_THEMES: ThemeOption[] = [...GRADIENT_THEMES, ...IMAGE_THEMES];

const gradientById = new Map(GRADIENT_THEMES.map((t) => [t.id, t]));
const imageById = new Map(IMAGE_THEMES.map((t) => [t.id, t]));

function isImageUrl(value: string): boolean {
  return value.startsWith("data:image/") || /^https?:\/\//i.test(value);
}

export const getBackgroundImageUrl = (backgroundValue: string): string => {
  if (isImageUrl(backgroundValue)) return backgroundValue;
  return imageById.get(backgroundValue)?.css || imageById.get("classroom")!.css;
};

export const getBackgroundStyle = (backgroundValue: string): React.CSSProperties => {
  const value = backgroundValue || "classroom";

  // Gradient preset → CSS gradient background.
  const gradient = gradientById.get(value);
  if (gradient) {
    return { backgroundImage: gradient.css, backgroundSize: "cover" };
  }

  // Uploaded/hosted image or image theme → cover image.
  const imageUrl = getBackgroundImageUrl(value);
  return {
    backgroundImage: `url(${imageUrl})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
};

// A small preview style for theme swatches in the editor.
export const getThemeSwatchStyle = (theme: ThemeOption): React.CSSProperties => {
  if (theme.kind === "gradient") {
    return { backgroundImage: theme.css, backgroundSize: "cover" };
  }
  return {
    backgroundImage: `url(${theme.css})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
};

// Background style with an optional darkening overlay (readability on busy
// images, esp. AI-generated ones). Overlay is clamped to [0, 0.5]; 0 = plain.
export const getBackgroundStyleWithOverlay = (
  backgroundValue: string,
  overlay?: number,
): React.CSSProperties => {
  const style = getBackgroundStyle(backgroundValue);
  const alpha = typeof overlay === "number" && Number.isFinite(overlay)
    ? Math.min(0.5, Math.max(0, overlay))
    : 0;
  if (alpha <= 0 || !style.backgroundImage) return style;
  return {
    ...style,
    backgroundImage: `linear-gradient(rgba(0,0,0,${alpha}), rgba(0,0,0,${alpha})), ${style.backgroundImage}`,
  };
};
