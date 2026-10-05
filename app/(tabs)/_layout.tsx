import Ionicons from "@expo/vector-icons/Ionicons";
import { clsx } from "clsx";
import { Tabs } from "expo-router";
import { styled } from "nativewind";
import { useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { tabs } from "@/constants/data";
import type { IconName } from "@/constants/icons";
import { colors, components } from "@/constants/theme";

const Icon = styled(Ionicons);

const tabBar = components.tabBar;

type TabIconProps = {
  focused: boolean;
  icon: IconName;
};

const TabIcon = ({ focused, icon }: TabIconProps) => {
  return (
    <View className="tabs-icon">
      <View className={clsx("tabs-pill", focused && "tabs-active")}>
        <Icon
          name={icon}
          className={clsx("tabs-glyph", focused && "tabs-glyph-active")}
        />
      </View>
    </View>
  );
};

const TabLayout = () => {
  const insets = useSafeAreaInsets();
  const theme = colors[useColorScheme() === "dark" ? "dark" : "light"];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          position: "absolute",
          bottom: Math.max(insets.bottom, tabBar.horizontalInset),
          height: tabBar.height,
          marginHorizontal: tabBar.horizontalInset,
          borderRadius: tabBar.radius,
          backgroundColor: theme.primary,
          borderTopWidth: 0,
          elevation: 0,
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
            tabBarIcon: ({ focused }) => (
              <TabIcon focused={focused} icon={tab.icon} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
};

export default TabLayout;
