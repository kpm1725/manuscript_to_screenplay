import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api/client";
import { colors, fonts, radius, spacing } from "@/src/theme";
import FormModal from "./FormModal";

export type ResourceField = {
  key: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  primary?: boolean; // displayed as card title
  secondary?: boolean; // displayed as subtitle
  body?: boolean; // displayed as long body
};

type Item = Record<string, any> & { id: string };

type Props = {
  projectId: string;
  resource: string; // e.g. "characters"
  title: string;
  emptyHint: string;
  fields: ResourceField[];
  iconName?: keyof typeof import("@expo/vector-icons").Ionicons.glyphMap;
};

export default function ResourceList({ projectId, resource, title, emptyHint, fields, iconName }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ items: Item[] }>(`/projects/${projectId}/${resource}`);
      setItems(data.items);
    } catch (e) { console.warn(e); }
  }, [projectId, resource]);

  useEffect(() => {
    (async () => {
      await load();
      setLoading(false);
    })();
  }, [load]);

  const handleSubmit = async (vals: Record<string, string>) => {
    try {
      const payload: Record<string, any> = {};
      fields.forEach((f) => { payload[f.key] = (vals[f.key] || "").trim(); });
      // numeric "order" for scenes/beats
      if ("order" in payload) {
        payload.order = parseInt(payload.order, 10) || items.length;
      }
      if (editing) {
        await apiFetch(`/projects/${projectId}/${resource}/${editing.id}`, { method: "PATCH", body: payload });
      } else {
        await apiFetch(`/projects/${projectId}/${resource}`, { method: "POST", body: payload });
      }
      setShowForm(false); setEditing(null);
      await load();
    } catch (e) { console.warn(e); }
  };

  const onDelete = async (it: Item) => {
    try {
      await apiFetch(`/projects/${projectId}/${resource}/${it.id}`, { method: "DELETE" });
      await load();
    } catch (e) { console.warn(e); }
  };

  const primaryKey = fields.find((f) => f.primary)?.key || fields[0].key;
  const secondaryKey = fields.find((f) => f.secondary)?.key;
  const bodyKey = fields.find((f) => f.body)?.key;

  const initialValues = (it: Item | null): Record<string, string> => {
    const r: Record<string, string> = {};
    fields.forEach((f) => { r[f.key] = it ? String(it[f.key] ?? "") : ""; });
    return r;
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID={`${resource}-screen`}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID={`${resource}-back`}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{title}</Text>
        <Pressable testID={`${resource}-add`} onPress={() => { setEditing(null); setShowForm(true); }} hitSlop={10}>
          <Ionicons name="add" size={26} color={colors.brand} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: 80 }}>
        {loading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
        ) : items.length === 0 ? (
          <View style={styles.empty} testID={`${resource}-empty`}>
            {iconName && <Ionicons name={iconName} size={36} color={colors.onSurfaceTertiary} />}
            <Text style={styles.emptyText}>{emptyHint}</Text>
            <Pressable
              testID={`${resource}-empty-cta`}
              onPress={() => { setEditing(null); setShowForm(true); }}
              style={styles.emptyBtn}
            >
              <Text style={styles.emptyBtnText}>Add the first</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            {items.map((it) => (
              <Pressable
                key={it.id}
                testID={`${resource}-item-${it.id}`}
                onPress={() => { setEditing(it); setShowForm(true); }}
                style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.surfaceTertiary }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={2}>{it[primaryKey] || "Untitled"}</Text>
                  {secondaryKey && !!it[secondaryKey] && (
                    <Text style={styles.cardSub} numberOfLines={1}>{String(it[secondaryKey]).toUpperCase()}</Text>
                  )}
                  {bodyKey && !!it[bodyKey] && (
                    <Text style={styles.cardBody} numberOfLines={3}>{it[bodyKey]}</Text>
                  )}
                </View>
                <Pressable
                  testID={`${resource}-delete-${it.id}`}
                  onPress={(e) => { e.stopPropagation(); onDelete(it); }}
                  hitSlop={10}
                  style={{ padding: 6 }}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.onSurfaceTertiary} />
                </Pressable>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <FormModal
        visible={showForm}
        title={editing ? `Edit ${title.replace(/s$/, "")}` : `New ${title.replace(/s$/, "")}`}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onSubmit={handleSubmit}
        submitLabel={editing ? "Save" : "Add"}
        fields={fields.map((f) => ({
          key: f.key,
          label: f.label,
          placeholder: f.placeholder,
          multiline: f.multiline,
          initial: editing ? String((editing as any)[f.key] ?? "") : "",
        }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.divider,
  },
  headerTitle: { fontFamily: fonts.serifBold, fontSize: 24, color: colors.onSurface },
  card: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
    alignItems: "flex-start",
  },
  cardTitle: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.onSurface },
  cardSub: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.brand, letterSpacing: 1.5, marginTop: 4 },
  cardBody: { fontFamily: fonts.serif, fontSize: 15, color: colors.onSurfaceSecondary, lineHeight: 20, marginTop: 8 },
  empty: { alignItems: "center", gap: spacing.md, paddingTop: 80 },
  emptyText: { fontFamily: fonts.serif, fontSize: 17, color: colors.onSurfaceSecondary, textAlign: "center", lineHeight: 24 },
  emptyBtn: { marginTop: spacing.md, paddingHorizontal: 22, paddingVertical: 12, backgroundColor: colors.brandPrimary, borderRadius: radius.pill },
  emptyBtnText: { fontFamily: fonts.sansMedium, color: colors.onBrandPrimary, fontSize: 14 },
});
