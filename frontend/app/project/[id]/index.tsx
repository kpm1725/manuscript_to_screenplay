import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api/client";
import { colors, fonts, spacing } from "@/src/theme";

const HERO = "https://images.unsplash.com/reserve/LJIZlzHgQ7WPSh5KVTCB_Typewriter.jpg?crop=entropy&cs=srgb&fm=jpg&w=1400&q=80";

type Project = {
  project_id: string;
  title: string;
  logline: string;
  genre: string;
  manuscript: string;
  screenplay: string;
};

type Section = { key: string; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap; route: string };

export default function ProjectHub() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [p, setP] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { project } = await apiFetch<{ project: Project }>(`/projects/${id}`);
      setP(project);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sections: Section[] = [
    { key: "manuscript", label: "Manuscript", sub: "Write your novel", icon: "document-text-outline", route: `/project/${id}/manuscript` },
    { key: "screenplay", label: "Screenplay Draft", sub: "Generated script in Fountain format", icon: "film-outline", route: `/project/${id}/screenplay` },
    { key: "characters", label: "Character Bible", sub: "Cast, arcs, and traits", icon: "people-outline", route: `/project/${id}/characters` },
    { key: "scenes", label: "Scene Board", sub: "Beats and structure", icon: "grid-outline", route: `/project/${id}/scenes` },
    { key: "locations", label: "Locations", sub: "INT./EXT. settings", icon: "location-outline", route: `/project/${id}/locations` },
    { key: "beats", label: "Plot Timeline", sub: "Act structure & turning points", icon: "git-branch-outline", route: `/project/${id}/beats` },
    { key: "notes", label: "Notes & Research", sub: "Inspirations and references", icon: "bookmark-outline", route: `/project/${id}/notes` },
    { key: "coverage", label: "Producer Coverage", sub: "AI-generated studio coverage report", icon: "ribbon-outline", route: `/project/${id}/coverage` },
  ];

  if (loading) {
    return (
      <View style={[styles.root, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (!p) {
    return (
      <View style={[styles.root, { padding: spacing.xl, paddingTop: insets.top + 60 }]}>
        <Text style={styles.bodyText}>Project not found.</Text>
        <Pressable onPress={() => router.back()}><Text style={{ color: colors.brand, marginTop: 12 }}>Go back</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="project-hub-screen">
      <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
        <View style={styles.hero}>
          <Image source={{ uri: HERO }} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient
            colors={["rgba(247,245,240,0.0)", "rgba(26,25,24,0.4)", "rgba(26,25,24,0.95)"]}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />
          <Pressable
            testID="project-back-button"
            onPress={() => router.replace("/library")}
            style={[styles.back, { top: insets.top + 8 }]}
            hitSlop={10}
          >
            <Ionicons name="chevron-back" size={26} color={colors.onSurfaceInverse} />
          </Pressable>
          <View style={styles.heroContent}>
            {!!p.genre && <Text style={styles.heroEyebrow}>{p.genre.toUpperCase()}</Text>}
            <Text style={styles.heroTitle} numberOfLines={3}>{p.title}</Text>
            {!!p.logline && <Text style={styles.heroLogline} numberOfLines={3}>{p.logline}</Text>}
          </View>
        </View>

        <View style={styles.sections}>
          {sections.map((s) => (
            <Pressable
              key={s.key}
              testID={`project-section-${s.key}`}
              onPress={() => router.push(s.route as any)}
              style={({ pressed }) => [styles.sectionRow, pressed && { backgroundColor: colors.surfaceSecondary }]}
            >
              <View style={styles.iconWrap}>
                <Ionicons name={s.icon} size={20} color={colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionLabel}>{s.label}</Text>
                <Text style={styles.sectionSub}>{s.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  bodyText: { fontFamily: fonts.serif, fontSize: 16, color: colors.onSurface },
  hero: { height: 360, justifyContent: "flex-end", overflow: "hidden" },
  back: {
    position: "absolute",
    left: spacing.md,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(26,25,24,0.35)", alignItems: "center", justifyContent: "center",
  },
  heroContent: { padding: spacing.xl, paddingBottom: spacing.xl, gap: 6 },
  heroEyebrow: { fontFamily: fonts.sansBold, letterSpacing: 3, fontSize: 11, color: colors.brandTertiary },
  heroTitle: { fontFamily: fonts.serifBold, fontSize: 42, lineHeight: 46, color: colors.onSurfaceInverse },
  heroLogline: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 22, color: "rgba(247,245,240,0.85)", marginTop: 4 },
  sections: { paddingTop: spacing.md },
  sectionRow: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  iconWrap: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  sectionLabel: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.onSurface },
  sectionSub: { fontFamily: fonts.sans, fontSize: 13, color: colors.onSurfaceTertiary, marginTop: 2 },
});
