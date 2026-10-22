import { Pressable, Text, View } from "react-native";

import { SkeletonRows } from "@/components/skeleton";
import type { ApiError } from "@/lib/api";

/**
 * A section's loading placeholder, error (with "Try again") or empty message;
 * null when there's data to show. (Pattern from DFS-Riches StatusView.)
 */
export default function StatusView({
  loading,
  error,
  empty,
  onRetry,
  rows,
}: {
  loading?: boolean;
  error?: ApiError | null;
  empty?: string | null;
  onRetry?: () => void;
  rows?: number;
}) {
  if (loading) return <SkeletonRows rows={rows} />;
  if (error) {
    const retryable = error.status === 0 ? error.code !== "not_configured" : error.status >= 500 || error.status === 429;
    return (
      <View className="items-center py-4" accessibilityLiveRegion="polite">
        <Text className="error-text">{error.message}</Text>
        {onRetry && retryable ? (
          <Pressable className="btn-outline mt-3" onPress={onRetry} accessibilityRole="button">
            <Text className="btn-outline-text">Try again</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  if (empty) return <Text className="empty-text">{empty}</Text>;
  return null;
}
