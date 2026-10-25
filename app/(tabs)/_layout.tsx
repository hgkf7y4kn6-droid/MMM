import { clsx } from "clsx";
import { Tabs } from "expo-router";
import { useColorScheme, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { tabs } from "@/constants/data";
import { colors, components } from "@/constants/theme";

const tabBar = components.tabBar;

const TabIcon = ({ focused, icon }: TabIconProps) => (
  <View className="tabs-icon">
    <View className={clsx("tabs-pill", focused && "tabs-active")}>
      <Icon name={icon} size={24} className={clsx("tabs-glyph", focused && "tabs-glyph-active")} />
    </View>
  </View>
);

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const theme = colors[useColorScheme() === "dark" ? "dark" : "light"];
  // A floating bar: full width less the margins on phones, centered at
  // maxWidth on tablets and desktop browsers.
  const side = Math.max(tabBar.horizontalInset, (width - tabBar.maxWidth) / 2);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        sceneStyle: { backgroundColor: theme.background },
        tabBarStyle: {
          position: "absolute",
          bottom: Math.max(insets.bottom, tabBar.horizontalInset),
          height: tabBar.height,
          marginLeft: side,
          marginRight: side,
          borderRadius: tabBar.radius,
          backgroundColor: theme.primary,
          borderTopWidth: 0,
          elevation: 0,
          shadowColor: "#000",
          shadowOpacity: 0.12,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
        },
        tabBarItemStyle: {
          paddingVertical: tabBar.height / 2 - tabBar.iconFrame / 1.6,
        },
        tabBarIconStyle: {
          width: tabBar.iconFrame,
          height: tabBar.iconFrame,
          alignSelf: "center",
        },
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarAccessibilityLabel: tab.title,
            tabBarIcon: ({ focused }) => <TabIcon focused={focused} icon={tab.icon} />,
          }}
        />
      ))}
    </Tabs>
  );
}
