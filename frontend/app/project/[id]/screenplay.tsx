import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator,
  Share,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api/client";
import { colors, fonts, radius, spacing } from "@/src/theme";

const SHORTCUTS = [
  { label: "INT.", insert: "\n\nINT. " },
  { label: "EXT.", insert: "\n\nEXT. " },
  { label: "Action", insert: "\n\n" },
  { label: "Character", insert: "\n\n          " },
  { label: "Dialogue", insert: "\n     " },
  { label: "(beat)", insert: "\n          (beat)" },
];

export default function Screenplay() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { project } = await apiFetch<{ project: { screenplay: string } }>(`/projects/${id}`);
        setText(project.screenplay || "");
        setSavedText(project.screenplay || "");
      } catch (e) { console.warn(e); }
      setLoading(false);
    })();
  }, [id]);

  useEffect(() => {
    if (loading) return;
    if (text === savedText) return;
    const t = setTimeout(async () => {
      setSaving(true);
      try {
        await apiFetch(`/projects/${id}`, { method: "PATCH", body: { screenplay: text } });
        setSavedText(text);
      } catch (e) { console.warn(e); }
      setSaving(false);
    }, 800);
    return () => clearTimeout(t);
  }, [text, savedText, id, loading]);

  const insertAtCursor = (frag: string) => {
    const start = selection.start;
    const end = selection.end;
    const next = text.slice(0, start) + frag + text.slice(end);
    setText(next);
    const pos = start + frag.length;
    setSelection({ start: pos, end: pos });
  };

  const exportScript = async () => {
    try {
      await Share.share({ message: text || "(empty screenplay)" });
    } catch {}
  };

  return (
    <View style={styles.root} testID="screenplay-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="screenplay-back">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.headerTitle}>Screenplay</Text>
          <Text style={styles.headerSub}>{saving ? "Saving…" : "Saved"} · Fountain</Text>
        </View>
        <Pressable testID="screenplay-export" onPress={exportScript} hitSlop={10}>
          <Ionicons name="share-outline" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        {loading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 60 }} />
        ) : (
          <TextInput
            testID="screenplay-input"
            value={text}
            onChangeText={setText}
            placeholder={"No script yet.\n\nUse 'Send to AI' from the manuscript to generate one, or start writing in Fountain format here."}
            placeholderTextColor={colors.onSurfaceTertiary}
            multiline
            textAlignVertical="top"
            selection={selection}
            onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
            style={[styles.editor]}
          />
        )}

        <View style={[styles.toolbar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
          {SHORTCUTS.map((s) => (
            <Pressable
              key={s.label}
              testID={`shortcut-${s.label.replace(/[^a-z]/gi, "")}`}
              style={styles.chip}
              onPress={() => insertAtCursor(s.insert)}
            >
              <Text style={styles.chipText}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.divider,
  },
  headerTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.onSurface },
  headerSub: { fontFamily: fonts.sans, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  editor: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 100,
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 20,
    color: colors.onSurface,
  },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    backgroundColor: "rgba(247,245,240,0.98)",
  },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border,
  },
  chipText: { fontFamily: fonts.mono, fontSize: 12, color: colors.onSurfaceSecondary },
});
