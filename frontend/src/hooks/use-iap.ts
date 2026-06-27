/**
 * use-iap.ts — wraps expo-iap for Google Play Billing + Apple IAP.
 * expo-iap is the current maintained successor to react-native-iap and
 * expo-in-app-purchases, fully compatible with Expo SDK 54.
 */
import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import {
  setup,
  getProducts,
  requestPurchase,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type ProductPurchase,
  type PurchaseError,
  type Product,
} from "expo-iap";
import { apiFetch } from "@/src/api/client";

export const IAP_SKUS = {
  per_report: Platform.OS === "android"
    ? "scribe_coverage_single"
    : "com.scribeapp.scribe.coverage_single",
  monthly_pro: Platform.OS === "android"
    ? "scribe_pro_monthly"
    : "com.scribeapp.scribe.pro_monthly",
} as const;

export type IAPProductId = keyof typeof IAP_SKUS;

export type IAPState = {
  ready: boolean;
  products: Product[];
  purchasing: IAPProductId | null;
  error: string | null;
  purchase: (id: IAPProductId) => Promise<void>;
};

export function useIAP(onPurchaseComplete?: () => void): IAPState {
  const [ready, setReady] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchasing, setPurchasing] = useState<IAPProductId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const purchaseListener = purchaseUpdatedListener(async (purchase: ProductPurchase) => {
      if (!mounted) return;
      try {
        await apiFetch("/billing/iap/verify", {
          method: "POST",
          body: {
            platform: Platform.OS,
            product_id: purchase.productId,
            purchase_token: purchase.purchaseToken,
            transaction_id: purchase.transactionId,
            transaction_receipt: purchase.transactionReceipt,
          },
        });
        await finishTransaction({ purchase, isConsumable: true });
        if (mounted) {
          setPurchasing(null);
          onPurchaseComplete?.();
        }
      } catch (e: any) {
        if (mounted) {
          setError(e?.message || "Purchase verification failed");
          setPurchasing(null);
        }
      }
    });

    const errorListener = purchaseErrorListener((e: PurchaseError) => {
      if (!mounted) return;
      if (e.code !== "E_USER_CANCELLED") setError(e.message || "Purchase failed");
      setPurchasing(null);
    });

    (async () => {
      try {
        await setup({ storekitMode: "STOREKIT2_MODE" });
        const skus = Object.values(IAP_SKUS);
        const fetched = await getProducts(skus);
        if (mounted) {
          setProducts(fetched);
          setReady(true);
        }
      } catch (e: any) {
        if (mounted) {
          setError(e?.message || "IAP unavailable");
          setReady(true);
        }
      }
    })();

    return () => {
      mounted = false;
      purchaseListener.remove();
      errorListener.remove();
    };
  }, []);

  const purchase = useCallback(async (id: IAPProductId) => {
    setError(null);
    setPurchasing(id);
    try {
      await requestPurchase({ sku: IAP_SKUS[id] });
    } catch (e: any) {
      if (e?.code !== "E_USER_CANCELLED") setError(e?.message || "Purchase failed");
      setPurchasing(null);
    }
  }, []);

  return { ready, products, purchasing, error, purchase };
}
