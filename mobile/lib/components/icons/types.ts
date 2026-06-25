/**
 * Shared icon prop contract — every icon in this folder accepts these.
 *
 * Visual language (matches the ChatGPT design system v2 contact sheet):
 *   - 24×24 SVG viewBox normalised
 *   - stroke-width: 2.5 at 24px → scales with size prop
 *   - round line caps + joins
 *   - geometric, angular where appropriate (matches the ATP wordmark vibe)
 *
 * Default colour is white so the icon reads on the dark surfaces of
 * the app. Pass `color={colors.green}` (or any string) for the "active"
 * state — screens can tint the same icon based on app state without
 * spawning new components.
 */
export interface IconProps {
  size?: number;       // default 24
  color?: string;      // default white
  strokeWidth?: number;
  /**
   * If true, animated icons run their loop. Static icons ignore this.
   * Lets a screen pause animations off-tab to save battery.
   */
  active?: boolean;
}

export const DEFAULTS = {
  size: 24,
  color: '#ffffff',
  strokeWidth: 2.5,
};
