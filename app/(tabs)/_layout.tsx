import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";

import { tabs } from "@/constants/data";

const TabLayout = () => (
  <Tabs screenOptions={{ headerShown: false }}>
    {tabs.map((tab) => (
      <Tabs.Screen
        key={tab.name}
        name={tab.name}
        options={{
          title: tab.title,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={tab.icon} color={color} size={size} />
          ),
        }}
      />
    ))}
  </Tabs>
);

export default TabLayout;
