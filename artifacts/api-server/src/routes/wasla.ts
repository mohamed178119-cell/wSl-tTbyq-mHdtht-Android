import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  CreateConversationRequestBody,
  CreateGroupBody,
  DecideConversationBody,
  GetDeviceQueryParams,
  ListConversationsQueryParams,
  ListMessagesQueryParams,
  RegisterDeviceResponse as DeviceProfile,
  SendMessageResponse as MessageSchema,
  UpdateDevicePresenceBody as PresenceRequest,
  RegisterDeviceBody,
  RegisterDeviceResponse,
  SendMessageBody,
  UpdateDevicePresenceQueryParams,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  conversationMembers,
  conversations,
  devices,
  messages,
} from "@workspace/db/schema";

const router: IRouter = Router();

const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function newCode(): string {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

function asIso(value: Date): string {
  return value.toISOString();
}

function bad(res: Response, message: string, status = 400) {
  return res.status(status).json({ message });
}

async function requireDevice(deviceId: string, res: Response) {
  const [device] = await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
  if (!device) {
    bad(res, "الجهاز غير مسجل", 404);
    return null;
  }
  return device;
}

function profile(device: typeof devices.$inferSelect) {
  return DeviceProfile.parse({
    deviceId: device.id,
    code: device.code,
    displayName: device.displayName,
    online: device.online,
  });
}

async function conversationPayload(conversationId: string, deviceId: string) {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conversation) return null;

  const members = await db
    .select({
      deviceId: devices.id,
      code: devices.code,
      displayName: devices.displayName,
      decision: conversationMembers.decision,
    })
    .from(conversationMembers)
    .innerJoin(devices, eq(devices.id, conversationMembers.deviceId))
    .where(eq(conversationMembers.conversationId, conversationId));

  const [lastMessage] = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(1);

  const ownMember = members.find((member) => member.deviceId === deviceId);
  const status =
    conversation.type === "group"
      ? "active"
      : ownMember?.decision === "accepted"
        ? "active"
        : conversation.creatorDeviceId === deviceId
          ? "pending_outgoing"
          : "pending_incoming";

  const other = members.find((member) => member.deviceId !== deviceId);
  const name =
    conversation.type === "group"
      ? conversation.name
      : other?.displayName || `كود ${other?.code || "غير معروف"}`;

  return {
    id: conversation.id,
    name,
    type: conversation.type,
    status,
    members,
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          conversationId: lastMessage.conversationId,
          senderDeviceId: lastMessage.senderDeviceId,
          text: lastMessage.text,
          createdAt: asIso(lastMessage.createdAt),
          clientId: lastMessage.clientId,
        }
      : null,
  };
}

router.post("/devices/register", async (req: Request, res: Response) => {
  const input = RegisterDeviceBody.parse(req.body);
  const [existing] = await db.select().from(devices).where(eq(devices.id, input.deviceId)).limit(1);
  if (existing) {
    if (input.displayName && input.displayName !== existing.displayName) {
      const [updated] = await db
        .update(devices)
        .set({ displayName: input.displayName, online: true, lastSeenAt: new Date() })
        .where(eq(devices.id, input.deviceId))
        .returning();
      return res.json(profile(updated));
    }
    return res.json(profile(existing));
  }

  let code = newCode();
  while ((await db.select().from(devices).where(eq(devices.code, code)).limit(1)).length > 0) {
    code = newCode();
  }
  const [created] = await db
    .insert(devices)
    .values({
      id: input.deviceId,
      code,
      displayName: input.displayName || "مستخدم جديد",
      online: true,
      lastSeenAt: new Date(),
    })
    .returning();
  return res.json(RegisterDeviceResponse.parse(profile(created)));
});

router.get("/devices/me", async (req: Request, res: Response) => {
  const input = GetDeviceQueryParams.parse(req.query);
  const device = await requireDevice(input.deviceId, res);
  if (device) return res.json(profile(device));
  return;
});

router.patch("/devices/me", async (req: Request, res: Response) => {
  const query = UpdateDevicePresenceQueryParams.parse(req.query);
  const input = PresenceRequest.parse(req.body);
  const device = await requireDevice(query.deviceId, res);
  if (!device) return;
  const [updated] = await db
    .update(devices)
    .set({ online: input.online, lastSeenAt: new Date() })
    .where(eq(devices.id, query.deviceId))
    .returning();
  return res.json(profile(updated));
});

router.get("/conversations", async (req: Request, res: Response) => {
  const input = ListConversationsQueryParams.parse(req.query);
  const device = await requireDevice(input.deviceId, res);
  if (!device) return;
  const memberships = await db
    .select()
    .from(conversationMembers)
    .where(eq(conversationMembers.deviceId, input.deviceId));
  const result = (
    await Promise.all(memberships.map((member) => conversationPayload(member.conversationId, input.deviceId)))
  ).filter((value): value is NonNullable<typeof value> => Boolean(value));
  result.sort((a, b) => (b.lastMessage?.createdAt || "").localeCompare(a.lastMessage?.createdAt || ""));
  return res.json(result);
});

router.post("/conversations", async (req: Request, res: Response) => {
  const input = CreateConversationRequestBody.parse(req.body);
  const creator = await requireDevice(input.deviceId, res);
  if (!creator) return;
  const [target] = await db.select().from(devices).where(eq(devices.code, input.targetCode.toUpperCase())).limit(1);
  if (!target) return bad(res, "الكود غير موجود", 404);
  if (target.id === creator.id) return bad(res, "لا يمكن بدء محادثة مع نفسك");
  const conversationId = newId("chat");
  await db.insert(conversations).values({
    id: conversationId,
    type: "direct",
    name: target.displayName,
    creatorDeviceId: creator.id,
  });
  await db.insert(conversationMembers).values([
    { conversationId, deviceId: creator.id, decision: "accepted" },
    { conversationId, deviceId: target.id, decision: "pending" },
  ]);
  const payload = await conversationPayload(conversationId, creator.id);
  return res.status(201).json(payload);
});

router.post("/conversations/groups", async (req: Request, res: Response) => {
  const input = CreateGroupBody.parse(req.body);
  const creator = await requireDevice(input.deviceId, res);
  if (!creator) return;
  const normalizedCodes = [...new Set(input.memberCodes.map((code) => code.trim().toUpperCase()).filter(Boolean))];
  const invited = await db.select().from(devices).where(inArray(devices.code, normalizedCodes));
  if (invited.length !== normalizedCodes.length) return bad(res, "تأكد أن كل الأكواد صحيحة", 404);
  if (invited.some((device) => device.id === creator.id)) return bad(res, "لا تضف كودك إلى المجموعة");
  const conversationId = newId("group");
  await db.insert(conversations).values({
    id: conversationId,
    type: "group",
    name: input.name.trim(),
    creatorDeviceId: creator.id,
  });
  await db.insert(conversationMembers).values([
    { conversationId, deviceId: creator.id, decision: "accepted" },
    ...invited.map((device) => ({ conversationId, deviceId: device.id, decision: "accepted" })),
  ]);
  const payload = await conversationPayload(conversationId, creator.id);
  return res.status(201).json(payload);
});

router.post("/conversations/:conversationId/decision", async (req: Request, res: Response) => {
  const conversationId = String(req.params.conversationId);
  const input = DecideConversationBody.parse(req.body);
  const device = await requireDevice(input.deviceId, res);
  if (!device) return;
  const [membership] = await db
    .select()
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.deviceId, input.deviceId)))
    .limit(1);
  if (!membership) return bad(res, "طلب المحادثة غير موجود", 404);
  if (input.decision === "reject") {
    await db
      .delete(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.deviceId, input.deviceId)));
  } else {
    await db
      .update(conversationMembers)
      .set({ decision: "accepted" })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.deviceId, input.deviceId)));
  }
  const payload = await conversationPayload(conversationId, input.deviceId);
  if (!payload) return bad(res, "المحادثة غير موجودة", 404);
  return res.json(payload);
});

router.get("/conversations/:conversationId/messages", async (req: Request, res: Response) => {
  const conversationId = String(req.params.conversationId);
  const input = ListMessagesQueryParams.parse(req.query);
  const device = await requireDevice(input.deviceId, res);
  if (!device) return;
  const [membership] = await db
    .select()
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.deviceId, input.deviceId)))
    .limit(1);
  if (!membership || membership.decision !== "accepted") return bad(res, "المحادثة ليست مفعلة", 403);
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
  return res.json(rows.map((message) => MessageSchema.parse({
    id: message.id,
    conversationId: message.conversationId,
    senderDeviceId: message.senderDeviceId,
    text: message.text,
    createdAt: asIso(message.createdAt),
    clientId: message.clientId,
  })));
});

router.post("/conversations/:conversationId/messages", async (req: Request, res: Response) => {
  const input = SendMessageBody.parse(req.body);
  const conversationId = String(req.params.conversationId);
  const device = await requireDevice(input.deviceId, res);
  if (!device) return;
  const [membership] = await db
    .select()
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.deviceId, input.deviceId)))
    .limit(1);
  if (!membership || membership.decision !== "accepted") return bad(res, "المحادثة ليست مفعلة", 403);

  const [existing] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.clientId, input.clientId)))
    .limit(1);
  if (existing) {
    return res.status(200).json(MessageSchema.parse({
      id: existing.id,
      conversationId: existing.conversationId,
      senderDeviceId: existing.senderDeviceId,
      text: existing.text,
      createdAt: asIso(existing.createdAt),
      clientId: existing.clientId,
    }));
  }

  const [created] = await db
    .insert(messages)
    .values({
      id: newId("msg"),
      conversationId,
      senderDeviceId: input.deviceId,
      text: input.text.trim(),
      clientId: input.clientId,
    })
    .returning();
  return res.status(201).json(MessageSchema.parse({
    id: created.id,
    conversationId: created.conversationId,
    senderDeviceId: created.senderDeviceId,
    text: created.text,
    createdAt: asIso(created.createdAt),
    clientId: created.clientId,
  }));
});

export default router;