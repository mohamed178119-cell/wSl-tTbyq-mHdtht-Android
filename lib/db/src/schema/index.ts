import { pgTable, text, boolean, timestamp, primaryKey, unique } from "drizzle-orm/pg-core";

export const devices = pgTable("wasla_devices", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  displayName: text("display_name").notNull().default("مستخدم جديد"),
  online: boolean("online").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable("wasla_conversations", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  creatorDeviceId: text("creator_device_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversationMembers = pgTable(
  "wasla_conversation_members",
  {
    conversationId: text("conversation_id").notNull(),
    deviceId: text("device_id").notNull(),
    decision: text("decision").notNull().default("pending"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.conversationId, table.deviceId] }),
  }),
);

export const messages = pgTable(
  "wasla_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    senderDeviceId: text("sender_device_id").notNull(),
    text: text("text").notNull(),
    clientId: text("client_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clientMessage: unique("wasla_messages_client_id").on(table.conversationId, table.clientId),
  }),
);

export type Device = typeof devices.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type ConversationMember = typeof conversationMembers.$inferSelect;
export type Message = typeof messages.$inferSelect;