import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Share, Modal,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api/client";
import { colors, fonts, radius, spacing } from "@/src/theme";
import { useIAP, type IAPProductId } from "@/src/hooks/use-iap";

type Coverage = {
  report: string;
  source: "manuscript" | "screenplay";
  generated_at: string;
};

type Entitlement = {
  free_used: boolean;
  credits: number;
  pro_until: string | null;
  is_pro: boolean;
};

const SECTION_KEYWORDS = [
  "LOGLINE",
  "SYNOPSIS",
  "GENRE & COMPARABLES",
  "GENRE AND COMPARABLES",
  "CHARACTER ANALYSIS",
  "STRENGTHS",
  "WEAKNESSES",
  "MARKET VERDICT",
];

function parseSections(report: string): { heading: string; body: string }[] {
  if (!report) return [];
  const lines = report.split("\n");
  const sections: { heading: string; body: string[] }[] = [];
  let current: { heading: string; body: string[] } | null = null;
  for (const ln of lines) {
    const trimmed = ln.trim();
    const isHeading =
      trimmed.length > 0 &&
      trimmed === trimmed.toUpperCase() &&
      SECTION_KEYWORDS.some((k) => trimmed.startsWith(k));
    if (isHeading) {
      if (current) sections.push(current);
      current = { heading: trimmed, body: [] };
    } else if (current) {
      current.body.push(ln);
    }
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ heading: s.heading, body: s.body.join("\n").trim() }));
}

function verdictColor(verdict: string): string {
  const v = verdict.toUpperCase();
  if (v.startsWith("RECOMMEND")) return colors.success;
  if (v.startsWith("CONSIDER")) return colors.warning;
  if (v.startsWith("PASS")) return colors.error;
  return colors.info;
}

export default function CoverageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"manuscript" | "screenplay">("manuscript");
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);

  const loadEntitlement = useCallback(async () => {
    try {
      const data = await apiFetch<{ entitlement: Entitlement }>(`/billing/entitlements`);
      setEntitlement(data.entitlement);
    } catch {}
  }, []);

  const iap = useIAP(async () => {
    // Called after successful purchase + backend verification
    await loadEntitlement();
    setShowPaywall(false);
  });

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ coverage: Coverage | null }>(`/projects/${id}/coverage`);
      setCoverage(data.coverage);
      if (data.coverage?.source) setSource(data.coverage.source);
    } catch (e: any) {
      setError(e?.message || "Failed to load coverage");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
    loadEntitlement();
  }, [load, loadEntitlement]);

  // Show IAP error in the main error state
  useEffect(() => {
    if (iap.error) setError(iap.error);
  }, [iap.error]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const data = await apiFetch<{ coverage: Coverage }>(`/projects/${id}/coverage`, {
        method: "POST",
        body: { use_screenplay: source === "screenplay" },
      });
      setCoverage(data.coverage);
      await loadEntitlement();
    } catch (e: any) {
      const msg = e?.message || "Failed to generate report";
      if (msg.includes("402") || msg.toLowerCase().includes("payment_required")) {
        setShowPaywall(true);
      } else {
        setError(msg);
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleBuy = async (id: IAPProductId) => {
    setError(null);
    await iap.purchase(id);
  };

  const share = async () => {
    if (!coverage?.report) return;
    try { await Share.share({ message: coverage.report }); } catch {}
  };

  const getPrice = (productKey: IAPProductId): string => {
    const sku = IAP_SKUS[productKey];
    const product = iap.products.find((p) => p.productId === sku);
    return product?.localizedPrice ?? (productKey === "per_report" ? "$4.99" : "$9.99");
  };

  const sections = useMemo(() => parseSections(coverage?.report || ""), [coverage?.report]);
  const verdictSection = sections.find((s) => s.heading.startsWith("MARKET VERDICT"));
  const verdictWord = (verdictSection?.body.trim().split(/\s|\.|—|-/)[0] || "").toUpperCase();

  const entitlementBadge = useMemo(() => {
    if (!entitlement) return null;
    if (entitlement.is_pro) return { label: "PRO", color: colors.brand };
    if (entitlement.credits > 0) return { label: `${entitlement.credits} CREDITS`, color: colors.success };
    if (!entitlement.free_used) return { label: "1 FREE LEFT", color: colors.success };
    return { label: "PAID PLAN REQUIRED", color: colors.warning };
  }, [entitlement]);

  return (
    <View style={styles.root} testID="coverage-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="coverage-back" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.headerTitle}>Producer Coverage</Text>
          {entitlementBadge ? (
            <View style={[styles.badge, { borderColor: entitlementBadge.color }]}>
              <Text style={[styles.badgeText, { color: entitlementBadge.color }]}>
                {entitlementBadge.label}
              </Text>
            </View>
          ) : (
            <Text style={styles.headerSub}>Studio-grade AI script reader</Text>
          )}
        </View>
        <Pressable
          testID="coverage-share"
          onPress={share}
          hitSlop={10}
          disabled={!coverage?.report}
          style={{ opacity: coverage?.report ? 1 : 0.3 }}
        >
          <Ionicons name="share-outline" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 160 }}>
        <View style={styles.toggleRow}>
          {(["manuscript", "screenplay"] as const).map((s) => (
            <Pressable
              key={s}
              onPress={() => setSource(s)}
              style={[styles.toggleBtn, source === s && styles.toggleBtnActive]}
            >
              <Text style={[styles.toggleText, source === s && styles.toggleTextActive]}>
                From {s}
              </Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 60 }} />
        ) : !coverage ? (
          <View style={styles.empty}>
            <Ionicons name="ribbon-outline" size={42} color={colors.onSurfaceTertiary} />
            <Text style={styles.emptyTitle}>No coverage yet.</Text>
            <Text style={styles.emptySub}>
              Generate a studio-grade reader report from your {source}. Powered by Claude Sonnet 4.5.
            </Text>
          </View>
        ) : (
          <View style={styles.body}>
            {verdictSection && (
              <View style={[styles.verdictCard, { borderColor: verdictColor(verdictWord) }]}>
                <Text style={styles.verdictLabel}>MARKET VERDICT</Text>
                <Text style={[styles.verdictWord, { color: verdictColor(verdictWord) }]}>
                  {verdictWord || "—"}
                </Text>
                <Text style={styles.verdictBody}>{verdictSection.body}</Text>
              </View>
            )}

            {sections
              .filter((s) => !s.heading.startsWith("MARKET VERDICT"))
              .map((s, i) => (
                <View key={`${s.heading}-${i}`} style={styles.section}>
                  <Text style={styles.sectionHeading}>{s.heading}</Text>
                  <Text style={styles.sectionBody}>{s.body}</Text>
                </View>
              ))}

            <Text style={styles.generatedAt}>
              Generated {new Date(coverage.generated_at).toLocaleString()} · From {coverage.source}
            </Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <Pressable
          onPress={generate}
          disabled={generating}
          style={[styles.cta, generating && { opacity: 0.6 }]}
        >
          {generating ? (
            <>
              <ActivityIndicator color={colors.onBrandPrimary} />
              <Text style={styles.ctaText}>Reading your script…</Text>
            </>
          ) : (
            <>
              <Ionicons name="sparkles" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.ctaText}>
                {coverage ? "Regenerate Coverage" : "Generate Coverage Report"}
              </Text>
            </>
          )}
        </Pressable>
        <Text style={styles.footerHint}>
          {entitlement?.is_pro
            ? `Pro until ${entitlement.pro_until ? new Date(entitlement.pro_until).toLocaleDateString() : "—"}`
            : entitlement && entitlement.credits > 0
            ? `${entitlement.credits} credit${entitlement.credits === 1 ? "" : "s"} remaining`
            : entitlement && !entitlement.free_used
            ? "First report is on the house"
            : "Unlock more from the store"}
        </Text>
      </View>

      {/* Paywall modal */}
      <Modal
        visible={showPaywall}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPaywall(false)}
      >
        <Pressable style={styles.paywallBackdrop} onPress={() => setShowPaywall(false)} />
        <View style={[styles.paywallSheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.paywallGrabber} />
          <Text style={styles.paywallEyebrow}>UNLOCK PRODUCER COVERAGE</Text>
          <Text style={styles.paywallTitle}>You used your free report.</Text>
          <Text style={styles.paywallSub}>
            Pick a plan to keep generating studio-grade coverage on every project.
          </Text>

          {/* Single Report */}
          <Pressable
            onPress={() => handleBuy("per_report")}
            disabled={iap.purchasing !== null}
            style={[styles.planCard, iap.purchasing === "per_report" && { opacity: 0.7 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.planLabel}>Single Report</Text>
              <Text style={styles.planSub}>Pay only when you need it</Text>
            </View>
            {iap.purchasing === "per_report" ? (
              <ActivityIndicator color={colors.brand} />
            ) : (
              <Text style={styles.planPrice}>{getPrice("per_report")}</Text>
            )}
          </Pressable>

          {/* 30-Day Pro */}
          <Pressable
            onPress={() => handleBuy("monthly_pro")}
            disabled={iap.purchasing !== null}
            style={[styles.planCard, styles.planCardFeatured, iap.purchasing === "monthly_pro" && { opacity: 0.7 }]}
          >
            <View style={styles.planBadge}>
              <Text style={styles.planBadgeText}>BEST VALUE</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.planLabel, styles.planLabelOnDark]}>30 Days Pro</Text>
              <Text style={[styles.planSub, styles.planSubOnDark]}>Unlimited coverages for a month</Text>
            </View>
            {iap.purchasing === "monthly_pro" ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={[styles.planPrice, styles.planPriceOnDark]}>{getPrice("monthly_pro")}</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => setShowPaywall(false)}
            style={{ marginTop: spacing.md, alignSelf: "center", padding: spacing.sm }}
          >
            <Text style={styles.paywallCancel}>Maybe later</Text>
          </Pressable>
          <Text style={styles.paywallFinePrint}>
            Payment processed by {"\n"}Google Play · Apple App Store
          </Text>
        </View>
      </Modal>
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
  headerTitle: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.onSurface },
  headerSub: { fontFamily: fonts.sans, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  toggleRow: {
    flexDirection: "row", marginHorizontal: spacing.xl, marginTop: spacing.lg,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, padding: 4,
  },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.pill, alignItems: "center" },
  toggleBtnActive: { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  toggleText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.onSurfaceTertiary },
  toggleTextActive: { color: colors.onSurface },
  empty: { alignItems: "center", paddingTop: 60, paddingHorizontal: spacing.xl, gap: spacing.sm },
  emptyTitle: { fontFamily: fonts.serifBold, fontSize: 26, color: colors.onSurface, textAlign: "center", marginTop: spacing.md },
  emptySub: { fontFamily: fonts.serif, fontSize: 16, color: colors.onSurfaceSecondary, textAlign: "center", lineHeight: 22 },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, gap: spacing.xl },
  verdictCard: { borderWidth: 2, borderRadius: radius.md, padding: spacing.lg, backgroundColor: colors.surface },
  verdictLabel: { fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 2, color: colors.onSurfaceTertiary },
  verdictWord: { fontFamily: fonts.serifBold, fontSize: 36, marginTop: 4 },
  verdictBody: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 22, color: colors.onSurfaceSecondary, marginTop: spacing.sm },
  section: { gap: spacing.sm },
  sectionHeading: { fontFamily: fonts.sansBold, fontSize: 12, letterSpacing: 2, color: colors.brand },
  sectionBody: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 26, color: colors.onSurface },
  generatedAt: { fontFamily: fonts.sans, fontSize: 11, color: colors.onSurfaceTertiary, textAlign: "center", marginTop: spacing.md },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.xl, paddingTop: spacing.md,
    backgroundColor: "rgba(247,245,240,0.96)",
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.divider,
    alignItems: "center", gap: 6,
  },
  cta: {
    backgroundColor: colors.brandPrimary, paddingVertical: 16, paddingHorizontal: 24,
    borderRadius: radius.pill, flexDirection: "row", alignItems: "center", gap: 8,
    width: "100%", justifyContent: "center",
  },
  ctaText: { color: colors.onBrandPrimary, fontFamily: fonts.sansMedium, fontSize: 15 },
  footerHint: { fontFamily: fonts.sans, fontSize: 11, color: colors.onSurfaceTertiary },
  errorBox: {
    marginHorizontal: spacing.xl, marginTop: spacing.lg, padding: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.error,
    backgroundColor: "rgba(122,46,46,0.06)",
  },
  errorText: { fontFamily: fonts.sans, fontSize: 13, color: colors.error },
  badge: { marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderRadius: radius.pill },
  badgeText: { fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 1.5 },
  paywallBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(26,25,24,0.55)" },
  paywallSheet: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.xl, paddingTop: spacing.md,
  },
  paywallGrabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.md },
  paywallEyebrow: { fontFamily: fonts.sansBold, letterSpacing: 2, color: colors.brand, fontSize: 11 },
  paywallTitle: { fontFamily: fonts.serifBold, fontSize: 28, color: colors.onSurface, marginTop: 4, lineHeight: 32 },
  paywallSub: { fontFamily: fonts.serif, fontSize: 15, color: colors.onSurfaceSecondary, lineHeight: 22, marginTop: spacing.sm, marginBottom: spacing.lg },
  planCard: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 18, paddingHorizontal: spacing.lg,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    marginBottom: spacing.md, backgroundColor: colors.surface,
  },
  planCardFeatured: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  planBadge: { position: "absolute", top: -10, right: 16, backgroundColor: colors.brand, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  planBadgeText: { fontFamily: fonts.sansBold, letterSpacing: 1.5, fontSize: 9, color: colors.onBrandPrimary },
  planLabel: { fontFamily: fonts.serifBold, fontSize: 20, color: colors.onSurface },
  planLabelOnDark: { color: colors.onSurfaceInverse },
  planSub: { fontFamily: fonts.sans, fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  planSubOnDark: { color: colors.brandTertiary },
  planPrice: { fontFamily: fonts.serifBold, fontSize: 22, color: colors.onSurface },
  planPriceOnDark: { color: colors.onSurfaceInverse },
  paywallCancel: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.onSurfaceTertiary },
  paywallFinePrint: { fontFamily: fonts.sans, fontSize: 11, color: colors.onSurfaceTertiary, textAlign: "center", marginTop: spacing.md },
});
