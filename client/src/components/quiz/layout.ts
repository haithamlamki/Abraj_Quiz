// Shared quiz-stage layout tokens — THE single source of sizing for the
// editor, preview modal, /preview page, host, and player. Never size these
// regions with per-page CSS; import from here so surfaces cannot drift.
//
// Values are measured from the Kahoot reference screenshot (1258×735):
//   left rail ≈ 11% · right panel ≈ 17% · content spans ~96% of the canvas ·
//   question bar ≈ 44px · media = the FLEXIBLE middle region at ~55% content
//   width with a 3:2 ratio · answer cards FIXED ≈ 84px tall · grid gap ≈ 10px ·
//   "Add more answers" sits directly below the grid — spare vertical space is
//   absorbed by the media region, never left below the answers.

/** Fixed answer-card height (text mode). Long text clamps; cards never grow. */
export const QUIZ_CARD_H = "h-[72px] sm:h-[84px]";

/** Gap used by every answer grid. */
export const QUIZ_GRID_GAP = "gap-2 sm:gap-2.5";

/** Question bar height (editor input and renderer card share this). */
export const QUIZ_QUESTION_BAR = "min-h-[44px] sm:min-h-[48px]";

/** Stage padding / vertical rhythm shared by editor canvas and renderer. */
export const QUIZ_STAGE_PAD = "p-3 sm:p-4";
export const QUIZ_STAGE_GAP = "gap-3 sm:gap-4";

/** Media region: flexible middle that absorbs spare height, centered. */
export const QUIZ_MEDIA_WRAP = "flex-1 min-h-0 flex items-center justify-center";
/** Media box: ~55% content width × the full flexible height (the reference's
 *  460×305 at 1258×735). Images keep their ratio via object-contain — a CSS
 *  aspect-ratio here fights the flex sizing and overflows the page. */
export const QUIZ_MEDIA_BOX = "h-full w-[55%] rounded-xl overflow-hidden";

/** Outer stage container used by host + player live pages (full canvas). */
export const QUIZ_STAGE_CONTAINER = "w-full flex-1 flex flex-col min-h-0";

/** Editor chrome: rail/panel proportions from the reference (desktop). Below
 *  lg the editor stacks vertically (canvas → rail strip → panel), so the
 *  rail/panel become full-width rows. */
export const EDITOR_LEFT_RAIL = "w-full lg:w-[11%] lg:min-w-[142px] lg:max-w-[200px]";
export const EDITOR_RIGHT_PANEL = "w-full lg:w-[17%] lg:min-w-[224px] lg:max-w-[300px]";
