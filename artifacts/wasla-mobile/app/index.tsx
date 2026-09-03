import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Conversation,
  DeviceProfile,
  Message,
  getGetDeviceQueryKey,
  getListConversationsQueryKey,
  getListMessagesQueryKey,
  useCreateConversationRequest,
  useCreateGroup,
  useDecideConversation,
  useGetDevice,
  useListConversations,
  useListMessages,
  useRegisterDevice,
  useSendMessage,
  useUpdateDevicePresence,
} from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';

type Tab = 'code' | 'chats' | 'about';

type QueuedMessage = Message & { queued: true };

const DEVICE_KEY = '@wasla/device-id';
const QUEUE_KEY = '@wasla/message-queue';

function createLocalId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function errorText(error: unknown) {
  if (error instanceof Error) {
    return error.message.replace(/^HTTP \d+ [^:]+:\s*/, '');
  }
  return 'حصل خطأ، جرّب مرة ثانية';
}

export default function WaslaHome() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('code');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDirectForm, setShowDirectForm] = useState(false);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [targetCode, setTargetCode] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [inputText, setInputText] = useState('');
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [localReady, setLocalReady] = useState(false);
  const registeredRef = useRef(false);
  const flushingRef = useRef(false);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 2400);
  };

  const register = useRegisterDevice();
  const profileQuery = useGetDevice(
    { deviceId: deviceId ?? '' },
    { query: { enabled: Boolean(deviceId), refetchInterval: 30000, queryKey: getGetDeviceQueryKey({ deviceId: deviceId ?? '' }) } },
  );
  const conversationsQuery = useListConversations(
    { deviceId: deviceId ?? '' },
    {
      query: {
        enabled: Boolean(deviceId),
        refetchInterval: online ? 5000 : false,
        queryKey: getListConversationsQueryKey({ deviceId: deviceId ?? '' }),
      },
    },
  );
  const selectedConversation = useMemo(
    () => conversationsQuery.data?.find((conversation) => conversation.id === selectedId) ?? null,
    [conversationsQuery.data, selectedId],
  );
  const messagesQuery = useListMessages(
    selectedId ?? '',
    { deviceId: deviceId ?? '' },
    {
      query: {
        enabled: Boolean(deviceId && selectedConversation?.status === 'active' && selectedId),
        refetchInterval: online ? 3000 : false,
        queryKey: getListMessagesQueryKey(selectedId ?? '', { deviceId: deviceId ?? '' }),
      },
    },
  );

  const presence = useUpdateDevicePresence({
    mutation: {
      onSuccess: (profile) => setOnline(profile.online),
      onError: (error) => showToast(errorText(error)),
    },
  });
  const directRequest = useCreateConversationRequest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
        setShowDirectForm(false);
        setTargetCode('');
        showToast('تم إرسال طلب المحادثة');
      },
      onError: (error) => showToast(errorText(error)),
    },
  });
  const groupCreate = useCreateGroup({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
        setShowGroupForm(false);
        setGroupMembers([]);
        setGroupName('');
        showToast('تم إنشاء المجموعة');
      },
      onError: (error) => showToast(errorText(error)),
    },
  });
  const decision = useDecideConversation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
        showToast('تم تحديث الطلب');
      },
      onError: (error) => showToast(errorText(error)),
    },
  });
  const send = useSendMessage({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
        if (selectedId) {
          queryClient.invalidateQueries({
            queryKey: [`/api/conversations/${selectedId}/messages`],
          });
        }
      },
    },
  });

  const profile: DeviceProfile | null = register.data ?? profileQuery.data ?? null;

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(DEVICE_KEY), AsyncStorage.getItem(QUEUE_KEY)])
      .then(([storedId, storedQueue]) => {
        const nextId = storedId || createLocalId('device');
        setDeviceId(nextId);
        if (!storedId) void AsyncStorage.setItem(DEVICE_KEY, nextId);
        if (storedQueue) {
          try {
            setQueuedMessages(JSON.parse(storedQueue) as QueuedMessage[]);
          } catch {
            void AsyncStorage.removeItem(QUEUE_KEY);
          }
        }
      })
      .finally(() => setLocalReady(true));
  }, []);

  useEffect(() => {
    if (deviceId && !registeredRef.current) {
      registeredRef.current = true;
      register.mutate({ data: { deviceId } });
    }
  }, [deviceId, register]);

  useEffect(() => {
    if (profile) setOnline(profile.online);
  }, [profile?.online]);

  useEffect(() => {
    void AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queuedMessages));
  }, [queuedMessages]);

  useEffect(() => {
    if (!deviceId || !online || queuedMessages.length === 0 || flushingRef.current) return;
    flushingRef.current = true;
    const flush = async () => {
      for (const queued of queuedMessages) {
        try {
          await send.mutateAsync({
            conversationId: queued.conversationId,
            data: {
              deviceId,
              text: queued.text,
              clientId: queued.clientId,
            },
          });
          setQueuedMessages((current) => current.filter((message) => message.clientId !== queued.clientId));
        } catch {
          break;
        }
      }
      flushingRef.current = false;
    };
    void flush();
  }, [deviceId, online, queuedMessages, send]);

  const toggleOnline = async () => {
    if (!deviceId || presence.isPending) return;
    const nextOnline = !online;
    await Haptics.selectionAsync();
    setOnline(nextOnline);
    presence.mutate({ params: { deviceId }, data: { online: nextOnline } });
    showToast(nextOnline ? 'رجعت أونلاين — بنزامن رسائلك' : 'أوفلاين — رسائلك محفوظة على الجهاز');
  };

  const openConversation = (conversation: Conversation) => {
    setSelectedId(conversation.id);
    setTab('chats');
  };

  const submitDirect = () => {
    if (!deviceId || !targetCode.trim()) {
      showToast('اكتب الكود الأول');
      return;
    }
    directRequest.mutate({
      data: { deviceId, targetCode: targetCode.trim().toUpperCase() },
    });
  };

  const addMember = () => {
    const value = groupCode.trim().toUpperCase();
    if (!value || groupMembers.includes(value)) return;
    setGroupMembers((current) => [...current, value]);
    setGroupCode('');
  };

  const submitGroup = () => {
    if (!deviceId || !groupName.trim()) {
      showToast('اكتب اسم المجموعة');
      return;
    }
    if (groupMembers.length < 2) {
      showToast('أضف كودين على الأقل');
      return;
    }
    groupCreate.mutate({
      data: { deviceId, name: groupName.trim(), memberCodes: groupMembers },
    });
  };

  const queueLocalMessage = (message: QueuedMessage) => {
    setQueuedMessages((current) => [...current, message]);
  };

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || !deviceId || !selectedId || selectedConversation?.status !== 'active') return;
    const message: QueuedMessage = {
      id: createLocalId('local'),
      conversationId: selectedId,
      senderDeviceId: deviceId,
      text,
      createdAt: new Date().toISOString(),
      clientId: createLocalId('client'),
      queued: true,
    };
    setInputText('');
    Keyboard.dismiss();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!online) {
      queueLocalMessage(message);
      showToast('اتحفظت على الجهاز وهتتبعت لما النت يرجع');
      return;
    }
    try {
      await send.mutateAsync({
        conversationId: selectedId,
        data: { deviceId, text, clientId: message.clientId },
      });
    } catch {
      queueLocalMessage(message);
      setOnline(false);
      showToast('مفيش اتصال — اتحفظت الرسالة للمزامنة');
    }
  };

  const shareCode = async () => {
    if (!profile?.code) return;
    await Share.share({ message: `كودي على وصلة: ${profile.code}` });
  };

  const refresh = () => {
    void Promise.all([profileQuery.refetch(), conversationsQuery.refetch(), messagesQuery.refetch()]);
  };

  const displayMessages: Message[] = useMemo(() => {
    const serverMessages = messagesQuery.data ?? [];
    const localMessages = selectedId
      ? queuedMessages.filter((message) => message.conversationId === selectedId)
      : [];
    return [...serverMessages, ...localMessages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [messagesQuery.data, queuedMessages, selectedId]);

  if (!localReady || register.isPending || (!profile && !register.isError && !profileQuery.isError)) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <View style={[styles.logo, { backgroundColor: colors.primary }]}>
          <Ionicons name="git-merge-outline" size={32} color={colors.primaryForeground} />
        </View>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>بنجهّز وصلة...</Text>
      </View>
    );
  }

  const onlineColor = online ? colors.primary : colors.mutedForeground;
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
        <View style={styles.brandRow}>
          <View style={[styles.brandMark, { backgroundColor: colors.primary }]}>
            <Ionicons name="git-merge-outline" size={22} color={colors.primaryForeground} />
          </View>
          <View>
            <Text style={[styles.brand, { color: colors.foreground }]}>وصلة</Text>
            <Text style={[styles.brandSub, { color: colors.mutedForeground }]}>تواصل بموافقتك</Text>
          </View>
        </View>
        <Pressable
          testID="presence-toggle"
          onPress={toggleOnline}
          style={({ pressed }) => [
            styles.presence,
            { backgroundColor: colors.secondary, borderColor: colors.border, opacity: pressed ? 0.78 : 1 },
          ]}
        >
          <View style={[styles.presenceDot, { backgroundColor: onlineColor }]} />
          <Text style={[styles.presenceText, { color: onlineColor }]}>{online ? 'أونلاين' : 'أوفلاين'}</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        {tab === 'code' && (
          <ScrollView
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 110 }]}
            refreshControl={<RefreshControl refreshing={profileQuery.isFetching} onRefresh={refresh} tintColor={colors.primary} />}
          >
            <View style={styles.heroCopy}>
              <Text style={[styles.eyebrow, { color: colors.primary }]}>هويتك على وصلة</Text>
              <Text style={[styles.pageTitle, { color: colors.foreground }]}>كودك هو مفتاح التواصل</Text>
              <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>
                شارك الكود مع الأشخاص اللي تثق فيهم، وأنت اللي بتقرر تبدأ المحادثة أو ترفضها.
              </Text>
            </View>
            <View style={[styles.codeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.codeGlow, { borderColor: colors.primary }]} />
              <Text style={[styles.codeLabel, { color: colors.mutedForeground }]}>الكود الخاص بيك</Text>
              <Text selectable style={[styles.codeValue, { color: colors.foreground }]}>
                {profile?.code ?? '------'}
              </Text>
              <Text style={[styles.codeHint, { color: colors.mutedForeground }]}>الكود ثابت على جهازك</Text>
              <Pressable
                testID="share-code"
                onPress={shareCode}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Ionicons name="share-social-outline" size={18} color={colors.primaryForeground} />
                <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>مشاركة الكود</Text>
              </Pressable>
            </View>
            <View style={styles.featureRow}>
              <Feature icon="shield-checkmark-outline" title="موافقتك أولًا" text="مفيش محادثة تبدأ من غير قبولك." colors={colors} />
              <Feature icon="sync-outline" title="مزامنة حقيقية" text="بياناتك محفوظة على السيرفر." colors={colors} />
            </View>
            <View style={[styles.infoPanel, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <Ionicons name="cloud-offline-outline" size={23} color={colors.accent} />
              <View style={styles.infoCopy}>
                <Text style={[styles.infoTitle, { color: colors.foreground }]}>يشتغل حتى لو النت قطع</Text>
                <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
                  الرسائل الجديدة بتتحفظ محليًا وتتزامن تلقائيًا أول ما ترجع أونلاين.
                </Text>
              </View>
            </View>
          </ScrollView>
        )}

        {tab === 'chats' && (
          <View style={styles.chatScreen}>
            {!selectedConversation ? (
              <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}>
                <View style={styles.sectionHeading}>
                  <Text style={[styles.pageTitle, { color: colors.foreground }]}>المحادثات</Text>
                  <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>
                    كل محادثة هنا بدأت بطلب وموافقة واضحة.
                  </Text>
                </View>
                <View style={styles.actionRow}>
                  <Pressable
                    testID="new-direct"
                    onPress={() => {
                      setShowDirectForm((value) => !value);
                      setShowGroupForm(false);
                    }}
                    style={({ pressed }) => [
                      styles.actionCard,
                      { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 },
                    ]}
                  >
                    <Ionicons name="key-outline" size={22} color={colors.primaryForeground} />
                    <Text style={[styles.actionTitle, { color: colors.primaryForeground }]}>أدخل كود</Text>
                    <Text style={[styles.actionHint, { color: colors.primaryForeground }]}>ابدأ طلب جديد</Text>
                  </Pressable>
                  <Pressable
                    testID="new-group"
                    onPress={() => {
                      setShowGroupForm((value) => !value);
                      setShowDirectForm(false);
                    }}
                    style={({ pressed }) => [
                      styles.actionCard,
                      { backgroundColor: colors.secondary, borderColor: colors.border, opacity: pressed ? 0.82 : 1 },
                    ]}
                  >
                    <Ionicons name="people-outline" size={22} color={colors.accent} />
                    <Text style={[styles.actionTitle, { color: colors.foreground }]}>مجموعة</Text>
                    <Text style={[styles.actionHint, { color: colors.mutedForeground }]}>اجمع أكتر من شخص</Text>
                  </Pressable>
                </View>
                {showDirectForm && (
                  <FormPanel colors={colors} title="إرسال طلب محادثة" icon="key-outline">
                    <TextInput
                      testID="target-code-input"
                      value={targetCode}
                      onChangeText={setTargetCode}
                      placeholder="مثال: ABC-123"
                      placeholderTextColor={colors.mutedForeground}
                      autoCapitalize="characters"
                      style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
                    />
                    <FormButtons
                      colors={colors}
                      onCancel={() => setShowDirectForm(false)}
                      onConfirm={submitDirect}
                      confirmText={directRequest.isPending ? 'جاري الإرسال...' : 'إرسال الطلب'}
                    />
                  </FormPanel>
                )}
                {showGroupForm && (
                  <FormPanel colors={colors} title="إنشاء مجموعة" icon="people-outline">
                    <TextInput
                      value={groupName}
                      onChangeText={setGroupName}
                      placeholder="اسم المجموعة"
                      placeholderTextColor={colors.mutedForeground}
                      style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
                    />
                    <View style={styles.codeInputRow}>
                      <TextInput
                        value={groupCode}
                        onChangeText={setGroupCode}
                        placeholder="كود عضو"
                        placeholderTextColor={colors.mutedForeground}
                        autoCapitalize="characters"
                        style={[styles.input, styles.grow, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
                        onSubmitEditing={addMember}
                      />
                      <Pressable onPress={addMember} style={[styles.addButton, { backgroundColor: colors.accent }]}>
                        <Ionicons name="add" size={22} color={colors.foreground} />
                      </Pressable>
                    </View>
                    {groupMembers.length > 0 && (
                      <View style={styles.chipRow}>
                        {groupMembers.map((member) => (
                          <Pressable
                            key={member}
                            onPress={() => setGroupMembers((current) => current.filter((item) => item !== member))}
                            style={[styles.chip, { backgroundColor: colors.primary + '22' }]}
                          >
                            <Text style={[styles.chipText, { color: colors.primary }]}>{member}</Text>
                            <Ionicons name="close-circle" size={15} color={colors.primary} />
                          </Pressable>
                        ))}
                      </View>
                    )}
                    <FormButtons
                      colors={colors}
                      onCancel={() => setShowGroupForm(false)}
                      onConfirm={submitGroup}
                      confirmText={groupCreate.isPending ? 'جاري الإنشاء...' : 'إنشاء المجموعة'}
                    />
                  </FormPanel>
                )}
                {conversationsQuery.isLoading ? (
                  <ActivityIndicator color={colors.primary} style={styles.listLoader} />
                ) : conversationsQuery.isError ? (
                  <ErrorState colors={colors} message={errorText(conversationsQuery.error)} onRetry={() => void conversationsQuery.refetch()} />
                ) : conversationsQuery.data?.length ? (
                  <View style={styles.conversationList}>
                    {conversationsQuery.data.map((conversation) => (
                      <ConversationRow
                        key={conversation.id}
                        conversation={conversation}
                        colors={colors}
                        onPress={() => openConversation(conversation)}
                      />
                    ))}
                  </View>
                ) : (
                  <EmptyState colors={colors} />
                )}
              </ScrollView>
            ) : (
              <ConversationDetail
                conversation={selectedConversation}
                messages={displayMessages}
                colors={colors}
                insetsBottom={insets.bottom}
                deviceId={deviceId ?? ''}
                inputText={inputText}
                onInputChange={setInputText}
                onSend={sendMessage}
                onBack={() => setSelectedId(null)}
                onDecision={(decisionValue) => decision.mutate({ conversationId: selectedConversation.id, data: { deviceId: deviceId ?? '', decision: decisionValue } })}
                isSending={send.isPending}
                isDeciding={decision.isPending}
              />
            )}
          </View>
        )}

        {tab === 'about' && (
          <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}>
            <View style={[styles.aboutCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.aboutIcon, { backgroundColor: colors.primary + '22' }]}>
                <Ionicons name="git-merge-outline" size={44} color={colors.primary} />
              </View>
              <Text style={[styles.aboutTitle, { color: colors.foreground }]}>وصلة</Text>
              <Text style={[styles.aboutText, { color: colors.mutedForeground }]}>
                مساحة تواصل خاصة، تخليك متحكم في مين يوصلك ومتى تبدأ المحادثة.
              </Text>
              <View style={[styles.aboutMeta, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                <Text style={[styles.aboutMetaLabel, { color: colors.mutedForeground }]}>تصميم وتطوير</Text>
                <Text style={[styles.aboutMetaValue, { color: colors.foreground }]}>محمد سعد</Text>
              </View>
              <Text style={[styles.version, { color: colors.mutedForeground }]}>الإصدار 1.0.0</Text>
            </View>
          </ScrollView>
        )}
      </View>

      <View style={[styles.bottomNav, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: insets.bottom + 8 }]}>
        <NavItem label="كودي" icon="qr-code-outline" active={tab === 'code'} colors={colors} onPress={() => { setTab('code'); setSelectedId(null); }} />
        <NavItem label="المحادثات" icon="chatbubbles-outline" active={tab === 'chats'} colors={colors} onPress={() => setTab('chats')} badge={conversationsQuery.data?.filter((item) => item.status === 'pending_incoming').length} />
        <NavItem label="حول التطبيق" icon="information-circle-outline" active={tab === 'about'} colors={colors} onPress={() => { setTab('about'); setSelectedId(null); }} />
      </View>

      {toastMessage && (
        <View style={[styles.toast, { backgroundColor: colors.secondary, borderColor: colors.border, bottom: insets.bottom + 84 }]}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.toastText, { color: colors.foreground }]}>{toastMessage}</Text>
        </View>
      )}
    </View>
  );
}

function Feature({ icon, title, text, colors }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[styles.feature, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={[styles.featureTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.featureText, { color: colors.mutedForeground }]}>{text}</Text>
    </View>
  );
}

function NavItem({ label, icon, active, colors, onPress, badge }: { label: string; icon: keyof typeof Ionicons.glyphMap; active: boolean; colors: ReturnType<typeof useColors>; onPress: () => void; badge?: number }) {
  return (
    <Pressable testID={`nav-${label}`} onPress={onPress} style={({ pressed }) => [styles.navItem, { opacity: pressed ? 0.72 : 1 }]}>
      <View>
        <Ionicons name={icon} size={23} color={active ? colors.primary : colors.mutedForeground} />
        {badge ? <View style={[styles.badge, { backgroundColor: colors.destructive }]}><Text style={styles.badgeText}>{badge}</Text></View> : null}
      </View>
      <Text style={[styles.navLabel, { color: active ? colors.primary : colors.mutedForeground }]}>{label}</Text>
    </Pressable>
  );
}

function FormPanel({ children, title, icon, colors }: { children: React.ReactNode; title: string; icon: keyof typeof Ionicons.glyphMap; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[styles.formPanel, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
      <View style={styles.formTitleRow}><Ionicons name={icon} size={19} color={colors.accent} /><Text style={[styles.formTitle, { color: colors.foreground }]}>{title}</Text></View>
      {children}
    </View>
  );
}

function FormButtons({ colors, onCancel, onConfirm, confirmText }: { colors: ReturnType<typeof useColors>; onCancel: () => void; onConfirm: () => void; confirmText: string }) {
  return (
    <View style={styles.formButtonRow}>
      <Pressable onPress={onCancel} style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}><Text style={[styles.secondaryButtonText, { color: colors.mutedForeground }]}>إلغاء</Text></Pressable>
      <Pressable onPress={onConfirm} style={({ pressed }) => [styles.primaryButton, styles.flexButton, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}><Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>{confirmText}</Text></Pressable>
    </View>
  );
}

function ConversationRow({ conversation, colors, onPress }: { conversation: Conversation; colors: ReturnType<typeof useColors>; onPress: () => void }) {
  const isPending = conversation.status === 'pending_incoming' || conversation.status === 'pending_outgoing';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.conversationRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.78 : 1 }]}>
      <View style={[styles.avatar, { backgroundColor: conversation.type === 'group' ? colors.accent : colors.primary }]}>
        <Ionicons name={conversation.type === 'group' ? 'people-outline' : 'person-outline'} size={21} color={colors.primaryForeground} />
      </View>
      <View style={styles.conversationCopy}>
        <View style={styles.conversationTitleRow}>
          <Text style={[styles.conversationName, { color: colors.foreground }]} numberOfLines={1}>{conversation.name}</Text>
          {conversation.type === 'group' ? <Text style={[styles.typePill, { backgroundColor: colors.accent + '24', color: colors.accent }]}>مجموعة</Text> : null}
        </View>
        <Text style={[styles.conversationLast, { color: isPending ? colors.accent : colors.mutedForeground }]} numberOfLines={1}>
          {conversation.lastMessage?.text ?? (conversation.status === 'pending_incoming' ? 'في انتظار موافقتك' : conversation.status === 'pending_outgoing' ? 'في انتظار الموافقة' : 'ابدأ الكلام')}
        </Text>
      </View>
      <Ionicons name="chevron-back" size={19} color={colors.mutedForeground} />
    </Pressable>
  );
}

function ConversationDetail({ conversation, messages, colors, insetsBottom, deviceId, inputText, onInputChange, onSend, onBack, onDecision, isSending, isDeciding }: { conversation: Conversation; messages: Message[]; colors: ReturnType<typeof useColors>; insetsBottom: number; deviceId: string; inputText: string; onInputChange: (value: string) => void; onSend: () => void; onBack: () => void; onDecision: (value: 'accept' | 'reject') => void; isSending: boolean; isDeciding: boolean }) {
  const active = conversation.status === 'active';
  return (
    <KeyboardAvoidingView style={styles.detailScreen} behavior="padding" keyboardVerticalOffset={0}>
      <View style={[styles.detailHeader, { borderBottomColor: colors.border }]}>
        <Pressable onPress={onBack} style={styles.backButton}><Ionicons name="chevron-forward" size={27} color={colors.foreground} /></Pressable>
        <View style={styles.detailTitleCopy}><Text style={[styles.detailName, { color: colors.foreground }]} numberOfLines={1}>{conversation.name}</Text><Text style={[styles.detailSub, { color: colors.mutedForeground }]}>{conversation.type === 'group' ? `${conversation.members.length} أعضاء` : 'محادثة فردية'}</Text></View>
        <View style={[styles.detailStatus, { backgroundColor: active ? colors.primary + '22' : colors.accent + '22' }]}><Text style={[styles.detailStatusText, { color: active ? colors.primary : colors.accent }]}>{active ? 'نشطة' : 'معلقة'}</Text></View>
      </View>
      {conversation.status === 'pending_incoming' ? (
        <View style={[styles.approvalBanner, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '55' }]}>
          <Ionicons name="hand-left-outline" size={24} color={colors.accent} />
          <Text style={[styles.approvalText, { color: colors.foreground }]}>مستخدم جديد دخل بكودك وعايز يبدأ محادثة معاك.</Text>
          <View style={styles.approvalActions}>
            <Pressable disabled={isDeciding} onPress={() => onDecision('reject')} style={[styles.rejectButton, { borderColor: colors.destructive }]}><Text style={[styles.rejectText, { color: colors.destructive }]}>رفض</Text></Pressable>
            <Pressable disabled={isDeciding} onPress={() => onDecision('accept')} style={[styles.primaryButton, styles.flexButton, { backgroundColor: colors.primary }]}><Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>قبول المحادثة</Text></Pressable>
          </View>
        </View>
      ) : conversation.status === 'pending_outgoing' ? (
        <View style={[styles.waitingBanner, { backgroundColor: colors.secondary, borderColor: colors.border }]}><Ionicons name="time-outline" size={22} color={colors.accent} /><Text style={[styles.waitingText, { color: colors.mutedForeground }]}>اتبعث طلبك، في انتظار موافقة الطرف الآخر.</Text></View>
      ) : null}
      <FlatList
        inverted
        data={[...messages].reverse()}
        keyExtractor={(item) => item.clientId}
        contentContainerStyle={styles.messageList}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        scrollEnabled={messages.length > 0}
        ListEmptyComponent={<View style={styles.emptyMessages}><Ionicons name="chatbubble-ellipses-outline" size={28} color={colors.mutedForeground} /><Text style={[styles.emptyMessagesText, { color: colors.mutedForeground }]}>{active ? 'لسه مفيش رسائل — ابدأ الكلام' : 'المحادثة هتظهر بعد الموافقة'}</Text></View>}
        renderItem={({ item }) => {
          const mine = item.senderDeviceId === deviceId;
          return <View style={[styles.messageRow, mine ? styles.messageMine : styles.messageOther]}><View style={[styles.bubble, { backgroundColor: mine ? colors.primary : colors.secondary, borderColor: colors.border }]}><Text style={[styles.bubbleText, { color: mine ? colors.primaryForeground : colors.foreground }]}>{item.text}</Text>{'queued' in item && item.queued ? <Text style={[styles.queuedText, { color: mine ? colors.primaryForeground : colors.mutedForeground }]}>في انتظار المزامنة</Text> : null}</View></View>;
        }}
      />
      <View style={[styles.inputDock, { paddingBottom: insetsBottom + 8, backgroundColor: colors.background }]}>
        <View style={[styles.messageInputWrap, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <TextInput
            testID="message-input"
            value={inputText}
            onChangeText={onInputChange}
            editable={active && !isSending}
            placeholder={active ? 'اكتب رسالة...' : 'المحادثة غير مفعلة'}
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[styles.messageInput, { color: colors.foreground }]}
            onSubmitEditing={onSend}
          />
          <Pressable testID="send-message" disabled={!active || !inputText.trim() || isSending} onPress={onSend} style={({ pressed }) => [styles.sendButton, { backgroundColor: colors.primary, opacity: !active || !inputText.trim() || isSending ? 0.35 : pressed ? 0.75 : 1 }]}><Ionicons name="arrow-up" size={20} color={colors.primaryForeground} /></Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function EmptyState({ colors }: { colors: ReturnType<typeof useColors> }) {
  return <View style={styles.emptyState}><View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}><Ionicons name="chatbubbles-outline" size={30} color={colors.mutedForeground} /></View><Text style={[styles.emptyTitle, { color: colors.foreground }]}>لسه مفيش محادثات</Text><Text style={[styles.emptyText, { color: colors.mutedForeground }]}>أدخل كود شخص تثق فيه أو أنشئ مجموعة للبدء.</Text></View>;
}

function ErrorState({ colors, message, onRetry }: { colors: ReturnType<typeof useColors>; message: string; onRetry: () => void }) {
  return <View style={styles.emptyState}><Ionicons name="cloud-offline-outline" size={32} color={colors.destructive} /><Text style={[styles.emptyTitle, { color: colors.foreground }]}>تعذر تحميل المحادثات</Text><Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{message}</Text><Pressable onPress={onRetry} style={[styles.primaryButton, { backgroundColor: colors.primary, marginTop: 16 }]}><Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>حاول مرة أخرى</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  header: { paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 66, height: 66, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  brand: { fontSize: 19, fontFamily: 'Inter_700Bold', textAlign: 'right' },
  brandSub: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1, textAlign: 'right' },
  presence: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 20, borderWidth: 1 },
  presenceDot: { width: 8, height: 8, borderRadius: 4 },
  presenceText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  content: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 28, gap: 18 },
  heroCopy: { gap: 7, marginBottom: 7 },
  eyebrow: { fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 0.7 },
  pageTitle: { fontSize: 27, fontFamily: 'Inter_700Bold', textAlign: 'right', lineHeight: 35 },
  pageSubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'right', lineHeight: 23 },
  codeCard: { borderWidth: 1, borderRadius: 26, padding: 27, alignItems: 'center', overflow: 'hidden' },
  codeGlow: { position: 'absolute', width: 220, height: 220, borderRadius: 110, borderWidth: 1, opacity: 0.13, top: -115 },
  codeLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', marginBottom: 11 },
  codeValue: { fontSize: 38, fontFamily: 'Inter_700Bold', letterSpacing: 2, marginBottom: 7 },
  codeHint: { fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 23 },
  primaryButton: { minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 17 },
  primaryButtonText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  featureRow: { flexDirection: 'row', gap: 10 },
  feature: { flex: 1, borderRadius: 18, borderWidth: 1, padding: 15, gap: 7, minHeight: 122 },
  featureTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', textAlign: 'right' },
  featureText: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'right', lineHeight: 17 },
  infoPanel: { borderWidth: 1, borderRadius: 18, padding: 16, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  infoCopy: { flex: 1, gap: 4 },
  infoTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', textAlign: 'right' },
  infoText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 19, textAlign: 'right' },
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-around', paddingTop: 10 },
  navItem: { alignItems: 'center', gap: 4, minWidth: 78 },
  navLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  badge: { position: 'absolute', top: -5, right: -10, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: '#FFFFFF', fontSize: 9, fontFamily: 'Inter_700Bold' },
  sectionHeading: { gap: 7 },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionCard: { flex: 1, borderRadius: 19, padding: 17, minHeight: 112, justifyContent: 'space-between', borderWidth: 1 },
  actionTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', textAlign: 'right' },
  actionHint: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'right' },
  formPanel: { borderWidth: 1, borderRadius: 20, padding: 15, gap: 10 },
  formTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  formTitle: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'right' },
  codeInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  grow: { flex: 1 },
  addButton: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderRadius: 9, paddingVertical: 6, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  formButtonRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  secondaryButton: { flex: 0.6, minHeight: 46, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  flexButton: { flex: 1 },
  listLoader: { marginTop: 28 },
  conversationList: { gap: 8 },
  conversationRow: { borderWidth: 1, borderRadius: 18, minHeight: 76, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  avatar: { width: 45, height: 45, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  conversationCopy: { flex: 1, gap: 5 },
  conversationTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  conversationName: { flex: 1, fontSize: 14, fontFamily: 'Inter_700Bold', textAlign: 'right' },
  typePill: { fontSize: 9, fontFamily: 'Inter_700Bold', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  conversationLast: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'right' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 64, paddingHorizontal: 30, gap: 9 },
  emptyIcon: { width: 65, height: 65, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 21 },
  chatScreen: { flex: 1 },
  detailScreen: { flex: 1 },
  detailHeader: { minHeight: 72, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1 },
  backButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  detailTitleCopy: { flex: 1, alignItems: 'flex-end', gap: 3 },
  detailName: { fontSize: 16, fontFamily: 'Inter_700Bold', textAlign: 'right' },
  detailSub: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  detailStatus: { paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8 },
  detailStatusText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  approvalBanner: { margin: 15, borderRadius: 17, borderWidth: 1, padding: 14, gap: 9 },
  approvalText: { fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'right', lineHeight: 20 },
  approvalActions: { flexDirection: 'row', gap: 8 },
  rejectButton: { flex: 0.6, minHeight: 42, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rejectText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  waitingBanner: { margin: 15, borderRadius: 17, borderWidth: 1, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 9 },
  waitingText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'right', lineHeight: 19 },
  messageList: { padding: 15, gap: 8, flexGrow: 1, justifyContent: 'flex-end' },
  messageRow: { width: '100%', flexDirection: 'row', marginVertical: 3 },
  messageMine: { justifyContent: 'flex-start' },
  messageOther: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '78%', paddingVertical: 10, paddingHorizontal: 13, borderRadius: 16, borderWidth: 1 },
  bubbleText: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20, textAlign: 'right' },
  queuedText: { fontSize: 9, fontFamily: 'Inter_400Regular', marginTop: 4, opacity: 0.75, textAlign: 'right' },
  emptyMessages: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, transform: [{ scaleY: -1 }] },
  emptyMessagesText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  inputDock: { paddingHorizontal: 13, paddingTop: 8 },
  messageInputWrap: { minHeight: 51, borderRadius: 17, borderWidth: 1, flexDirection: 'row', alignItems: 'flex-end', padding: 6, gap: 7 },
  messageInput: { flex: 1, maxHeight: 95, minHeight: 37, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 7, fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'right' },
  sendButton: { width: 37, height: 37, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  aboutCard: { marginTop: 35, borderWidth: 1, borderRadius: 25, padding: 28, alignItems: 'center', gap: 11 },
  aboutIcon: { width: 88, height: 88, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: 7 },
  aboutTitle: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  aboutText: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 22, textAlign: 'center' },
  aboutMeta: { width: '100%', borderRadius: 14, borderWidth: 1, padding: 12, alignItems: 'center', gap: 4, marginTop: 8 },
  aboutMetaLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  aboutMetaValue: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  version: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 4 },
  toast: { position: 'absolute', left: 18, right: 18, minHeight: 48, borderRadius: 15, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
  toastText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
});