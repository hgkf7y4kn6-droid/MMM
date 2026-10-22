import { Link } from "expo-router";
import { Text } from "react-native";

/** The short disclosure under every analysis screen; the full text is at /disclosures. */
export default function Disclaimer() {
  return (
    <Text className="disclaimer">
      Analytical research for decision support, not individualized investment advice or a recommendation to buy or
      sell. Past performance and historical growth don&apos;t guarantee future results; estimates can be wrong;
      dividends can be cut; investing involves risk of loss.{" "}
      <Link href="/disclosures" className="font-sans-semibold text-primary">
        Methodology & disclosures
      </Link>
    </Text>
  );
}
