import { create } from 'zustand';

interface Device {
  id: string;
  name: string;
  code: string;
}

interface Chat {
  id: string;
  name: string;
  lastMessage?: string;
  lastMessageTime?: Date;
}

interface AppStore {
  device: Device | null;
  chats: Chat[];
  setDevice: (device: Device) => void;
  addChat: (chat: Chat) => void;
  removeChat: (chatId: string) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  device: null,
  chats: [],
  setDevice: (device) => set({ device }),
  addChat: (chat) => set((state) => ({ chats: [...state.chats, chat] })),
  removeChat: (chatId) =>
    set((state) => ({
      chats: state.chats.filter((c) => c.id !== chatId),
    })),
}));
