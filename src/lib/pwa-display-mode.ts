type NavigatorWithStandalone = Navigator & { standalone?: boolean };

export const isStandalonePwa = () => {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const displayModeStandalone = typeof window.matchMedia === "function"
    && window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = (navigator as NavigatorWithStandalone).standalone === true;
  return displayModeStandalone || iosStandalone;
};
