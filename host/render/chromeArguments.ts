export const CHROME_ANGLES = ["gl", "gl-egl", "vulkan", "swiftshader"] as const;
export type ChromeAngle = (typeof CHROME_ANGLES)[number];

/** Every Chrome Wisp starts runs on a throwaway profile, so it keeps passwords in that profile instead of asking the desktop keyring. */
const profile = (directory: string) => ["--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync", "--password-store=basic", `--user-data-dir=${directory}`];

/** The headless Chrome that renders scenes through ANGLE `angle` and serves its DevTools on a free port. */
export const renderChromeArguments = (directory: string, angle: ChromeAngle, url: string) => [
  "--headless=new", ...profile(directory), "--remote-debugging-port=0", "--use-gl=angle", `--use-angle=${angle}`,
  ...(angle === "swiftshader" ? ["--enable-unsafe-swiftshader"] : []), ...(angle === "gl-egl" ? ["--ozone-platform=headless"] : []), url,
];

/** The standalone player's app window, headless when `headless` is set (SwiftShader under CI). */
export const playerChromeArguments = (directory: string, size: { readonly width: number; readonly height: number }, url: string, headless: boolean, ci: boolean) => [
  ...profile(directory), "--autoplay-policy=no-user-gesture-required", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", `--window-size=${size.width},${size.height}`,
  ...(headless ? ["--headless=new", "--use-gl=angle", ...(ci ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--use-angle=gl"])] : []), `--app=${url}`,
];

/** The press-latency reference page's X11 window at the top left of the display. */
export const referenceChromeArguments = (directory: string, page: string) => [
  ...profile(directory), "--ozone-platform=x11", "--window-position=0,0", "--window-size=800,600", `--app=file://${page}`,
];
