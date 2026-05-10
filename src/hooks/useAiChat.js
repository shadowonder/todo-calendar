import { useMemo, useState } from 'react';
import { requestAssistantReply, getProviderLabel } from '../ai/client.js';
import { useSettings } from '../context/SettingsContext.jsx';

const GREETING = 'Hello! I can help plan today\'s tasks, prioritize work, and break down next actions.';
const MAX_USER_HISTORY = 12;

function toModelMessages(messages) {
  return (messages || [])
    .filter((m) => m?.role === 'user' && typeof m?.text === 'string' && m.text.trim())
    .slice(-MAX_USER_HISTORY)
    .map((m) => ({
      role: 'user',
      content: m.text || '',
    }));
}

export function useAiChat({ selectedDate, tasks }) {
  const { effectiveAiConnection } = useSettings();
  const [chatSending, setChatSending] = useState(false);
  const [runtimeMeta, setRuntimeMeta] = useState(null);
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

    const now = Date.now();
    const userMsg = { id: now, role: 'user', text: input };
    const assistantMsgId = now + 1;
    const nextHistory = [
      ...chatMessages,
      userMsg,
      { id: assistantMsgId, role: 'assistant', text: '', thinkingPreview: '', streaming: true },
    ];

    setChatMessages(nextHistory);
    setChatSending(true);

    try {
      const result = await requestAssistantReply({
        connection: effectiveAiConnection,
        selectedDate,
        tasks,
        messages: toModelMessages(nextHistory),
        onStream: (event) => {
          const nextText = typeof event?.text === 'string' ? event.text : '';
          const nextThinking = typeof event?.thinkingPreview === 'string' ? event.thinkingPreview : '';
          const shouldReset = Boolean(event?.reset);
          if (event?.meta) setRuntimeMeta(event.meta);
          setChatMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== assistantMsgId) return msg;
              return {
                ...msg,
                text: shouldReset ? nextText : (nextText || msg.text || ''),
                thinkingPreview: event?.done
                  ? ''
                  : (shouldReset ? nextThinking : (nextThinking || msg.thinkingPreview || '')),
                streaming: !event?.done,
              };
            })
          );
        },
      });
      setRuntimeMeta(result?.meta || null);

      setChatMessages((prev) => [
        ...prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
              ...msg,
              text: result?.text || msg.text || '',
              thinkingPreview: '',
              streaming: false,
            }
            : msg
        ),
      ]);
    } catch (err) {
      const message = effectiveAiConnection?.type === 'native'
        ? 'Native AI is temporarily unavailable. Please retry or switch profile in Settings.'
        : (err instanceof Error && err.message ? err.message : 'AI request failed.');
      setChatMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? { ...msg, text: `Error: ${message}`, thinkingPreview: '', streaming: false }
            : msg
        )
      );
    } finally {
      setChatSending(false);
    }
  };

  return {
    chatMessages,
    chatSending,
    providerLabel,
    runtimeMeta,
    sendMessage,
  };
}
