import { useMemo, useState } from 'react';
import { requestAssistantReply, getProviderLabel } from '../ai/client.js';
import { useSettings } from '../context/SettingsContext.jsx';

const GREETING = 'Hello! I can help plan today\'s tasks, prioritize work, and break down next actions.';

function toModelMessages(messages) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.text || '',
  }));
}

export function useAiChat({ selectedDate, tasks }) {
  const { effectiveAiConnection } = useSettings();
  const [chatSending, setChatSending] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { id: 1, role: 'assistant', text: GREETING },
  ]);

  const providerLabel = useMemo(
    () => getProviderLabel(effectiveAiConnection),
    [effectiveAiConnection]
  );

  const sendMessage = async (text) => {
    const input = typeof text === 'string' ? text.trim() : '';
    if (!input || chatSending) return;

    const userMsg = { id: Date.now(), role: 'user', text: input };
    const nextHistory = [...chatMessages, userMsg];

    setChatMessages(nextHistory);
    setChatSending(true);

    try {
      const result = await requestAssistantReply({
        connection: effectiveAiConnection,
        selectedDate,
        tasks,
        messages: toModelMessages(nextHistory),
      });

      setChatMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'assistant',
          text: result.text,
        },
      ]);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'AI request failed.';
      setChatMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'assistant',
          text: `Error: ${message}`,
        },
      ]);
    } finally {
      setChatSending(false);
    }
  };

  return {
    chatMessages,
    chatSending,
    providerLabel,
    sendMessage,
  };
}

