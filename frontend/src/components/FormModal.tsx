import { View, Text, StyleSheet, Pressable, Modal, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useState } from "react";
import { colors, fonts, radius, spacing } from "@/src/theme";

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
  fields: { key: string; label: string; placeholder?: string; multiline?: boolean; initial?: string }[];
  submitLabel?: string;
  testID?: string;
};

export default function FormModal({ visible, title, onClose, onSubmit, fields, submitLabel = "Save", testID }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    fields.reduce((acc, f) => ({ ...acc, [f.key]: f.initial || "" }), {}),
  );

  // Reset values when the modal opens.
  const [lastOpen, setLastOpen] = useState(false);
  if (visible !== lastOpen) {
    setLastOpen(visible);
    if (visible) {
      setValues(fields.reduce((acc, f) => ({ ...acc, [f.key]: f.initial || "" }), {}));
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.kbWrap}
        pointerEvents="box-none"
      >
        <View style={styles.sheet} testID={testID}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{title}</Text>
          <View style={{ gap: spacing.md, marginTop: spacing.md }}>
            {fields.map((f) => (
              <View key={f.key}>
                <Text style={styles.label}>{f.label}</Text>
                <TextInput
                  testID={`form-input-${f.key}`}
                  style={[styles.input, f.multiline && { height: 96, textAlignVertical: "top" }]}
                  placeholder={f.placeholder || ""}
                  placeholderTextColor={colors.onSurfaceTertiary}
                  value={values[f.key]}
                  onChangeText={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                  multiline={f.multiline}
                />
              </View>
            ))}
          </View>
          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.btnGhost]} onPress={onClose}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable
              testID="form-submit"
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => onSubmit(values)}
            >
              <Text style={styles.btnPrimaryText}>{submitLabel}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(26,25,24,0.5)",
  },
  kbWrap: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    paddingBottom: spacing["2xl"],
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.md,
  },
  title: { fontFamily: fonts.serifBold, fontSize: 26, color: colors.onSurface },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.onSurfaceTertiary,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: spacing.xs,
  },
  input: {
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.onSurface,
  },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xl },
  btn: { flex: 1, height: 50, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  btnPrimary: { backgroundColor: colors.brandPrimary },
  btnPrimaryText: { fontFamily: fonts.sansMedium, color: colors.onBrandPrimary, fontSize: 15 },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  btnGhostText: { fontFamily: fonts.sansMedium, color: colors.onSurface, fontSize: 15 },
});
