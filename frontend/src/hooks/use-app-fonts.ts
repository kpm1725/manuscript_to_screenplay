import { useFonts } from "expo-font";

/**
 * Load app fonts from local assets.
 *
 * SETUP: Download these font files and place them in assets/fonts/:
 *   - CormorantGaramond-Regular.ttf  (https://fonts.google.com/specimen/Cormorant+Garamond)
 *   - CormorantGaramond-Bold.ttf
 *   - Inter-Regular.ttf              (https://fonts.google.com/specimen/Inter)
 *   - Inter-Medium.ttf
 *   - Inter-Bold.ttf
 *
 * SpaceMono-Regular.ttf is already bundled in assets/fonts/.
 */
export function useAppFonts() {
  return useFonts({
    CormorantGaramond: require("../../assets/fonts/CormorantGaramond-Regular.ttf"),
    CormorantGaramondBold: require("../../assets/fonts/CormorantGaramond-Bold.ttf"),
    SpaceMono: require("../../assets/fonts/SpaceMono-Regular.ttf"),
    SpaceMonoBold: require("../../assets/fonts/SpaceMono-Regular.ttf"), // Bold variant if available
    Satoshi: require("../../assets/fonts/Inter-Regular.ttf"),
    SatoshiMedium: require("../../assets/fonts/Inter-Medium.ttf"),
    SatoshiBold: require("../../assets/fonts/Inter-Bold.ttf"),
  });
}
