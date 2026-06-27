import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { Redirect } from "expo-router";

import { useAuth } from "@/src/context/AuthContext";
import { colors, fonts } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.center} testID="root-loading">
        <Text style={styles.brand}>Scribe</Text>
        <ActivityIndicator color={colors.brand} style={{ marginTop: 16 }} />
      </View>
    );
  }
  return <Redirect href={user ? "/library" : "/login"} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    fontFamily: fonts.serifBold,
    fontSize: 44,
    color: colors.onSurface,
    letterSpacing: 1,
  },
});
