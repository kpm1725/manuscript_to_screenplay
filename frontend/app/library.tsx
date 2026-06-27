import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/context/AuthContext";
import { apiFetch } from "@/src/api/client";
import { colors, fonts, radius, spacing } from "@/src/theme";
import FormModal from "@/src/components/FormModal";

type ProjectLite = {
  project_id: string;
  title: string;
  logline: string;
  genre: string;
  manuscript_len: number;
  screenplay_len: number;
  updated_at: string;
};

export default function Library() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [items, setItems] = useState<ProjectLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ projects: ProjectLite[] }>("/projects");
      setItems(data.projects);
    } catch (e) {
      console.warn(e);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
      setLoading(false);
    })();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const createProject = async (vals: Record<string, string>) => {
    if (!vals.title?.trim()) return;
    try {
      const { project } = await apiFetch<{ project: { project_id: string } }>("/projects", {
        method: "POST",
        body: { title: vals.title, logline: vals.logline, genre: vals.genre },
      });
      setShowNew(false);
      await load();
      router.push(`/project/${project.project_id}`);
    } catch (e) {
      console.warn(e);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="library-screen">
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>WELCOME, {(user?.name || user?.email || "WRITER").toUpperCase()}</Text>
          <Text style={styles.title}>Library</Text>
        </View>
        <Pressable testID="library-signout-button" onPress={signOut} hitSlop={10}>
          <Ionicons name="log-out-outline" size={22} color={colors.onSurfaceSecondary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      >
        {loading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 60 }} />
        ) : items.length === 0 ? (
          <View style={styles.empty} testID="library-empty">
            <Ionicons name="book-outline" size={42} color={colors.onSurfaceTertiary} />
            <Text style={styles.emptyTitle}>Your desk is empty.</Text>
            <Text style={styles.emptySub}>Begin your first manuscript and adapt it for the screen.</Text>
          </View>
        ) : (
          items.map((p) => (
            <Pressable
              key={p.project_id}
              testID={`project-row-${p.project_id}`}
              onPress={() => router.push(`/project/${p.project_id}`)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceSecondary }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{p.title}</Text>
                {!!p.logline && <Text style={styles.rowSub} numberOfLines={2}>{p.logline}</Text>}
                <View style={styles.meta}>
                  <Text style={styles.metaItem}>Novel · {p.manuscript_len.toLocaleString()} chars</Text>
                  <Text style={styles.metaDot}>·</Text>
                  <Text style={styles.metaItem}>Script · {p.screenplay_len.toLocaleString()} chars</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
          ))
        )}
      </ScrollView>

      <Pressable
        testID="library-new-project-fab"
        onPress={() => setShowNew(true)}
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
      >
        <Ionicons name="add" size={24} color={colors.onBrandPrimary} />
        <Text style={styles.fabText}>New Project</Text>
      </Pressable>

      <FormModal
        visible={showNew}
        title="New Project"
        onClose={() => setShowNew(false)}
        onSubmit={createProject}
        submitLabel="Create"
        testID="new-project-modal"
        fields={[
          { key: "title", label: "Title", placeholder: "The Untitled Novel" },
          { key: "logline", label: "Logline", placeholder: "A one-sentence pitch", multiline: true },
          { key: "genre", label: "Genre", placeholder: "Drama, Thriller, Sci-Fi…" },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  eyebrow: {
    fontFamily: fonts.sansMedium,
    color: colors.onSurfaceTertiary,
    fontSize: 11,
    letterSpacing: 2,
  },
  title: { fontFamily: fonts.serifBold, fontSize: 44, color: colors.onSurface, marginTop: 4 },
  row: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  rowTitle: { fontFamily: fonts.serifBold, fontSize: 24, color: colors.onSurface },
  rowSub: { fontFamily: fonts.serif, fontSize: 15, color: colors.onSurfaceSecondary, marginTop: 4, lineHeight: 20 },
  meta: { flexDirection: "row", alignItems: "center", marginTop: 8, gap: 6 },
  metaItem: { fontFamily: fonts.sans, fontSize: 11, color: colors.onSurfaceTertiary, letterSpacing: 0.4 },
  metaDot: { color: colors.onSurfaceTertiary },
  fab: {
    position: "absolute",
    right: spacing.xl,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  fabText: { color: colors.onBrandPrimary, fontFamily: fonts.sansMedium, fontSize: 14 },
  empty: { alignItems: "center", paddingTop: 80, paddingHorizontal: spacing.xl, gap: spacing.md },
  emptyTitle: { fontFamily: fonts.serifBold, fontSize: 26, color: colors.onSurface, textAlign: "center" },
  emptySub: { fontFamily: fonts.serif, fontSize: 16, color: colors.onSurfaceSecondary, textAlign: "center", lineHeight: 22 },
});
