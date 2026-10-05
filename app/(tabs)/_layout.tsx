import Ionicons from "@expo/vector-icons/Ionicons";
import { clsx } from "clsx";
import { Tabs } from "expo-router";
import { styled } from "nativewind";
import { View } from "react-native";

import { tabs } from "@/constants/data";
import type { IconName } from "@/constants/icons";

const Icon = styled(Ionicons);

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

const TabLayout = () => (
  <Tabs screenOptions={{ headerShown: false }}>
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

export default TabLayout;
