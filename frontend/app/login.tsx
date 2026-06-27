import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";

import { useAuth } from "@/src/context/AuthContext";
import { colors, fonts, spacing, radius } from "@/src/theme";

const HERO = "https://images.unsplash.com/reserve/LJIZlzHgQ7WPSh5KVTCB_Typewriter.jpg?crop=entropy&cs=srgb&fm=jpg&w=1600&q=80";

export default function Login() {
  const { signIn, loading } = useAuth();
  const [busy, setBusy] = useState(false);

  const handleSignIn = async () => {
    setBusy(true);
    try {
      await signIn();
    } catch (e) {
      console.warn(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root} testID="login-screen">
      <Image source={{ uri: HERO }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient
        colors={["rgba(247,245,240,0.0)", "rgba(26,25,24,0.55)", "rgba(26,25,24,0.95)"]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.content}>
        <Text style={styles.eyebrow}>SCRIBE</Text>
        <Text style={styles.title}>Turn your novel into a screenplay.</Text>
        <Text style={styles.subtitle}>
          A distraction-free workspace where prose becomes cinema, powered by an AI script doctor.
        </Text>

        <Pressable
          testID="login-google-button"
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
          onPress={handleSignIn}
          disabled={busy || loading}
        >
          {busy ? (
            <ActivityIndicator color={colors.onSurface} />
          ) : (
            <>
              <Ionicons name="logo-google" size={18} color={colors.onSurface} />
              <Text style={styles.ctaText}>Continue with Google</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.fineprint}>By continuing you agree to our terms of use.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceInverse },
  content: {
    flex: 1,
    justifyContent: "flex-end",
    padding: spacing.xl,
    paddingBottom: spacing["3xl"],
    gap: spacing.md,
  },
  eyebrow: {
    fontFamily: fonts.sansBold,
    color: colors.brandTertiary,
    letterSpacing: 4,
    fontSize: 12,
  },
  title: {
    fontFamily: fonts.serifBold,
    color: colors.onSurfaceInverse,
    fontSize: 40,
    lineHeight: 44,
  },
  subtitle: {
    fontFamily: fonts.serif,
    color: "rgba(247,245,240,0.85)",
    fontSize: 17,
    lineHeight: 24,
    marginBottom: spacing.lg,
  },
  cta: {
    backgroundColor: colors.surface,
    paddingVertical: 16,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  ctaText: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
    color: colors.onSurface,
  },
  fineprint: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: "rgba(247,245,240,0.5)",
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
