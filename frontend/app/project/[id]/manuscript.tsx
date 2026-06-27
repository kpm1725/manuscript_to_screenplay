import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView, Platform,
  ActivityIndicator, Modal, ScrollView, Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, API_BASE, getToken } from "@/src/api/client";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { pickAndImportManuscript } from "@/src/utils/fileImport";

export default function Manuscript() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showAgent, setShowAgent] = useState(false);

  // Agent state
  const [aiBusy, setAiBusy] = useState(false);
  const [aiOutput, setAiOutput] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { project } = await apiFetch<{ project: { manuscript: string } }>(`/projects/${id}`);
        setText(project.manuscript || "");
        setSavedText(project.manuscript || "");
      } catch (e) { console.warn(e); }
      setLoading(false);
    })();
  }, [id]);

  // Autosave (debounced)
  useEffect(() => {
    if (loading) return;
    if (text === savedText) return;
    const t = setTimeout(async () => {
      setSaving(true);
      try {
        await apiFetch(`/projects/${id}`, { method: "PATCH", body: { manuscript: text } });
        setSavedText(text);
      } catch (e) { console.warn(e); }
      setSaving(false);
    }, 800);
    return () => clearTimeout(t);
  }, [text, savedText, id, loading]);

  const handleImport = useCallback(async () => {
    setImporting(true);
    try {
      const result = await pickAndImportManuscript();
      if (!result) return; // user cancelled

      const confirmImport = () => new Promise<boolean>((resolve) => {
        if (!text.trim()) {
          resolve(true);
          return;
        }
        Alert.alert(
          "Replace manuscript?",
          `Importing "${result.fileName}" will replace your current text (${text.length.toLocaleString()} characters). This can't be undone.`,
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Replace", style: "destructive", onPress: () => resolve(true) },
          ]
        );
      });

      const confirmed = await confirmImport();
      if (!confirmed) return;

      setText(result.text);
      // Force immediate save so autosave doesn't lag
      setSaving(true);
      try {
        await apiFetch(`/projects/${id}`, { method: "PATCH", body: { manuscript: result.text } });
        setSavedText(result.text);
      } catch (e) { console.warn(e); }
      setSaving(false);

      Alert.alert(
        "Import complete",
        `"${result.fileName}" imported — ${result.characterCount.toLocaleString()} characters.`
      );
    } catch (e: any) {
      Alert.alert("Import failed", e?.message || "Could not read the file.");
    } finally {
      setImporting(false);
    }
  }, [id, text]);

  const runConvert = useCallback(async () => {
    setAiBusy(true); setAiOutput(""); setAiError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/projects/${id}/convert_sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text, style: "fountain" }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setAiOutput(data.text || "");
    } catch (e: any) {
      setAiError(e?.message || "Failed to generate screenplay");
    } finally {
      setAiBusy(false);
    }
  }, [id, text]);

  const appendToScreenplay = async () => {
    try {
      const { project } = await apiFetch<{ project: { screenplay: string } }>(`/projects/${id}`);
      const current = project.screenplay || "";
      const sep = current.trim().length ? "\n\n" : "";
      await apiFetch(`/projects/${id}`, { method: "PATCH", body: { screenplay: current + sep + aiOutput } });
      setShowAgent(false);
      setAiOutput("");
      router.push(`/project/${id}/screenplay`);
    } catch (e) { console.warn(e); }
  };

  const statusLabel = importing ? "Importing…" : saving ? "Saving…" : "Saved";

  return (
    <View style={styles.root} testID="manuscript-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="manuscript-back" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.headerTitle}>Manuscript</Text>
          <Text style={styles.headerSub}>{statusLabel}</Text>
        </View>
        {/* Import file button */}
        <Pressable
          testID="manuscript-import-btn"
          onPress={handleImport}
          hitSlop={10}
          disabled={importing}
          style={({ pressed }) => ({ opacity: importing || pressed ? 0.5 : 1 })}
        >
          {importing
            ? <ActivityIndicator size="small" color={colors.brand} />
            : <Ionicons name="document-attach-outline" size={24} color={colors.onSurface} />
          }
        </Pressable>
      </View>

      {/* File format hint — shown when editor is empty */}
      {!loading && !text.trim() && (
        <View style={styles.importHint}>
          <Ionicons name="cloud-upload-outline" size={18} color={colors.onSurfaceTertiary} />
          <Text style={styles.importHintText}>
            Tap{" "}
            <Ionicons name="document-attach-outline" size={13} color={colors.onSurfaceTertiary} />{" "}
            to import a <Text style={styles.importHintBold}>.txt</Text>,{" "}
            <Text style={styles.importHintBold}>.docx</Text>, or{" "}
            <Text style={styles.importHintBold}>.pdf</Text> file — or start typing below.
          </Text>
        </View>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 60 }} />
        ) : (
          <TextInput
            testID="manuscript-input"
            value={text}
            onChangeText={setText}
            placeholder={"Begin Chapter 1…\n\nThe first line of your novel awaits."}
            placeholderTextColor={colors.onSurfaceTertiary}
            multiline
            textAlignVertical="top"
            style={[styles.editor, { paddingBottom: 160 }]}
          />
        )}
        <View style={[styles.toolbar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Text style={styles.charCount}>{text.length.toLocaleString()} characters</Text>
          <Pressable
            testID="manuscript-ai-button"
            onPress={() => setShowAgent(true)}
            style={({ pressed }) => [styles.aiBtn, (!text.trim() || pressed) && { opacity: 0.6 }]}
            disabled={!text.trim()}
          >
            <Ionicons name="sparkles" size={16} color={colors.onBrandPrimary} />
            <Text style={styles.aiBtnText}>Send to AI</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <AgentSheet
        visible={showAgent}
        onClose={() => setShowAgent(false)}
        text={text}
        busy={aiBusy}
        output={aiOutput}
        error={aiError}
        onGenerate={runConvert}
        onAccept={appendToScreenplay}
      />
    </View>
  );
}

function AgentSheet({ visible, onClose, busy, output, error, onGenerate, onAccept }: {
  visible: boolean; onClose: () => void; text: string; busy: boolean;
  output: string; error: string | null; onGenerate: () => void; onAccept: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>AI Script Doctor</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.onSurface} />
          </Pressable>
        </View>
        <Text style={styles.sheetSub}>
          Powered by Claude Sonnet 4.5 · Converts your prose into industry-standard Fountain format.
        </Text>

        <ScrollView style={styles.outputBox} contentContainerStyle={{ padding: spacing.md }} testID="ai-output">
          {!output && !busy && !error && (
            <Text style={styles.placeholder}>
              {`Tap "Generate Screenplay" to convert your current manuscript into a screenplay.\n\nThe output will appear here in monospaced screenplay typography.`}
            </Text>
          )}
          {busy && (
            <View style={{ alignItems: "center", paddingVertical: 40 }}>
              <ActivityIndicator color={colors.brand} />
              <Text style={[styles.placeholder, { marginTop: 12, textAlign: "center" }]}>Drafting scene…</Text>
            </View>
          )}
          {error && <Text style={styles.errorText}>{error}</Text>}
          {!!output && <Text style={styles.outputText}>{output}</Text>}
        </ScrollView>

        <View style={styles.sheetActions}>
          {!output ? (
            <Pressable testID="ai-generate-btn" onPress={onGenerate} style={[styles.primaryBtn, busy && { opacity: 0.6 }]} disabled={busy}>
              <Ionicons name="sparkles" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.primaryBtnText}>Generate Screenplay</Text>
            </Pressable>
          ) : (
            <>
              <Pressable onPress={onGenerate} style={styles.ghostBtn} disabled={busy}>
                <Text style={styles.ghostBtnText}>Regenerate</Text>
              </Pressable>
              <Pressable testID="ai-accept-btn" onPress={onAccept} style={styles.primaryBtn}>
                <Ionicons name="checkmark" size={16} color={colors.onBrandPrimary} />
                <Text style={styles.primaryBtnText}>Append to Script</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.divider,
  },
  headerTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.onSurface },
  headerSub: { fontFamily: fonts.sans, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  importHint: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginHorizontal: spacing.xl, marginTop: spacing.lg,
    padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
    borderStyle: "dashed",
  },
  importHintText: {
    flex: 1, fontFamily: fonts.sans, fontSize: 13,
    color: colors.onSurfaceTertiary, lineHeight: 18,
  },
  importHintBold: { fontFamily: fonts.sansBold, color: colors.onSurfaceSecondary },
  editor: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    fontFamily: fonts.serif,
    fontSize: 19,
    lineHeight: 30,
    color: colors.onSurface,
  },
  toolbar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(247,245,240,0.92)",
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.divider,
  },
  charCount: { fontFamily: fonts.sans, fontSize: 12, color: colors.onSurfaceTertiary },
  aiBtn: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: radius.pill, flexDirection: "row", alignItems: "center", gap: 6,
  },
  aiBtnText: { color: colors.onBrandPrimary, fontFamily: fonts.sansMedium, fontSize: 14 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(26,25,24,0.45)" },
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0, top: 60,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.xl,
  },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sheetTitle: { fontFamily: fonts.serifBold, fontSize: 28, color: colors.onSurface },
  sheetSub: { fontFamily: fonts.sans, fontSize: 13, color: colors.onSurfaceTertiary, marginTop: 4, marginBottom: spacing.md },
  outputBox: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  placeholder: { fontFamily: fonts.serif, fontSize: 16, color: colors.onSurfaceTertiary, lineHeight: 22 },
  errorText: { fontFamily: fonts.sans, color: colors.error, fontSize: 14 },
  outputText: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 20, color: colors.onSurface },
  sheetActions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  primaryBtn: {
    flex: 1, backgroundColor: colors.brandPrimary, height: 52, borderRadius: radius.pill,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  primaryBtnText: { color: colors.onBrandPrimary, fontFamily: fonts.sansMedium, fontSize: 15 },
  ghostBtn: {
    flex: 1, borderWidth: 1, borderColor: colors.border, height: 52,
    borderRadius: radius.pill, alignItems: "center", justifyContent: "center",
  },
  ghostBtnText: { fontFamily: fonts.sansMedium, color: colors.onSurface, fontSize: 15 },
});
