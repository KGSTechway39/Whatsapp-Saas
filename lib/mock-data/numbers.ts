import { WhatsAppNumber } from "@/types";

export const mockNumbers: WhatsAppNumber[] = [
  {
    id: "n1",
    phoneNumber: "+91 98765 00001",
    displayName: "WASend Business - Primary",
    status: "active",
    dailyLimit: 1000,
    messagesSent: 8420,
    connectedDate: "2023-11-15",
    metaAccountId: "1234567890",
    phoneNumberId: "987654321",
  },
  {
    id: "n2",
    phoneNumber: "+91 98765 00002",
    displayName: "WASend Business - Secondary",
    status: "inactive",
    dailyLimit: 500,
    messagesSent: 1230,
    connectedDate: "2024-01-05",
    metaAccountId: "0987654321",
    phoneNumberId: "123456789",
  },
];
