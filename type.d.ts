import type { IconName } from "@/constants/icons";

declare global {
  type AppTab = {
    name: string;
    title: string;
    icon: IconName;
  };

  type TabIconProps = {
    focused: boolean;
    icon: IconName;
  };

  type BillingCycle = "monthly" | "yearly";
  type SubscriptionStatus = "active" | "paused" | "cancelled";

  type Subscription = {
    id: string;
    icon: IconName;
    name: string;
    plan?: string;
    category?: string;
    paymentMethod?: string;
    status: SubscriptionStatus;
    price: number;
    currency?: string;
    billing: BillingCycle;
    /** ISO date (YYYY-MM-DD) of the next charge */
    renewalDate: string;
  };

  type UpcomingSubscription = {
    id: string;
    icon: IconName;
    name: string;
    price: number;
    currency?: string;
    daysLeft: number;
  };

  type ListHeadingProps = {
    title: string;
  };

  type HomeUser = {
    name: string;
  };

  type HomeBalance = {
    /** Total monthly spend on subscriptions */
    amount: number;
    /** ISO date (YYYY-MM-DD) of the next renewal across all subscriptions */
    nextRenewalDate: string;
  };
}

export {};
