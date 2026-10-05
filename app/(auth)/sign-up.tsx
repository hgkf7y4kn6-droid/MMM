import { Link } from "expo-router";
import { Text, View } from "react-native";

export default function SignUp() {
  return (
    <View>
      <Text>Sign Up</Text>
      <Link href="/(auth)/sign-in">Sign In</Link>
    </View>
  );
}
